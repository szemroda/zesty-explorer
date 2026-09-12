import { Effect, Exit, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';
import { fixtureCollectionPage } from '../domain';
import { parseCollectionReference } from '../collection-reference';
import { createZestyApi, type ZestyTransport, type ZestyTransportRequest } from './index';

const parsedReference = parseCollectionReference(
  'https://8-abc123.manager.zesty.io/content/6-model123',
);
if (!parsedReference.ok) throw new Error('Test reference must parse');
const reference = parsedReference.value;

function fakeTransport(
  handler: (
    request: ZestyTransportRequest,
    attempt: number,
  ) => ZestyTransport['request'] extends (request: ZestyTransportRequest) => infer Result
    ? Result
    : never,
): { readonly transport: ZestyTransport; readonly requests: ZestyTransportRequest[] } {
  const requests: ZestyTransportRequest[] = [];
  return {
    requests,
    transport: {
      request: (request) => {
        requests.push(request);
        return handler(request, requests.length);
      },
    },
  };
}

describe('ZestyApi', () => {
  it('loads and decodes a collection schema with an authenticated GET', async () => {
    const fake = fakeTransport(() =>
      Effect.succeed({
        status: 200,
        headers: {},
        body: {
          data: [
            {
              ZUID: '12-title123',
              name: 'title',
              label: 'Title',
              datatype: 'text',
            },
            {
              ZUID: '12-author12',
              name: 'author',
              label: 'Author',
              datatype: 'one-to-one',
              relatedModelZUID: '6-author123',
            },
          ],
        },
      }),
    );

    const schema = await Effect.runPromise(
      createZestyApi(fake.transport).loadCollectionSchema(reference, 'private-token'),
    );

    expect(schema.fields).toEqual([
      { id: '12-title123', name: 'title', label: 'Title', kind: 'text' },
      {
        id: '12-author12',
        name: 'author',
        label: 'Author',
        kind: 'relationship',
        relatedModelZuid: '6-author123',
      },
    ]);
    expect(fake.requests).toEqual([
      {
        method: 'GET',
        url: 'https://8-abc123.api.zesty.io/v1/content/models/6-model123/fields?lang=en-US',
        headers: { authorization: 'Bearer private-token', accept: 'application/json' },
      },
    ]);
  });

  it('rejects malformed schema ZUIDs before branding them', async () => {
    const fake = fakeTransport(() =>
      Effect.succeed({
        status: 200,
        headers: {},
        body: { data: [{ ZUID: 'wrong', name: 'title', label: 'Title', datatype: 'text' }] },
      }),
    );
    const exit = await Effect.runPromiseExit(
      createZestyApi(fake.transport).loadCollectionSchema(reference, 'private-token'),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('loads all pages, applies published state, and normalizes once', async () => {
    const secondPage = {
      data: [
        {
          title: 'Third story',
          meta: {
            zuid: '7-000000-cccccc',
            created: '2026-01-03T12:00:00.000Z',
            modified: '2026-02-03T12:00:00.000Z',
            version: 1,
          },
        },
      ],
      _meta: { totalResults: 3, page: 2, limit: 2 },
    };
    const fake = fakeTransport((request) =>
      Effect.succeed({
        status: 200,
        headers: {},
        body: request.url.includes('page=2')
          ? secondPage
          : { ...fixtureCollectionPage, _meta: { totalResults: 3, page: 1, limit: 2 } },
      }),
    );

    const snapshot = await Effect.runPromise(
      createZestyApi(fake.transport, { pageSize: 2 }).loadCollectionSnapshot(
        reference,
        'published',
        'private-token',
      ),
    );

    expect(snapshot.items.map((item) => item.id)).toEqual([
      '7-000000-aaaaaa',
      '7-000000-bbbbbb',
      '7-000000-cccccc',
    ]);
    expect(snapshot.itemsById.get('7-000000-cccccc')?.fields.title).toBe('Third story');
    expect(snapshot.partial).toBe(false);
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests.every((request) => request.url.includes('_active=true'))).toBe(true);
  });

  it('retries transient failures but does not retry permission errors', async () => {
    const transient = fakeTransport((_request, attempt) =>
      attempt === 1
        ? Effect.fail({ kind: 'network' as const })
        : Effect.succeed({ status: 200, headers: {}, body: fixtureCollectionPage }),
    );
    await Effect.runPromise(
      createZestyApi(transient.transport, { retryDelaysMs: [0] }).loadCollectionSnapshot(
        reference,
        'latest',
        'private-token',
      ),
    );
    expect(transient.requests).toHaveLength(2);

    const forbidden = fakeTransport(() =>
      Effect.succeed({ status: 403, headers: {}, body: { error: 'forbidden' } }),
    );
    const exit = await Effect.runPromiseExit(
      createZestyApi(forbidden.transport, { retryDelaysMs: [0, 0] }).loadCollectionSnapshot(
        reference,
        'latest',
        'private-token',
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(forbidden.requests).toHaveLength(1);
  });

  it('maps authentication and decoding failures without exposing the token', async () => {
    for (const response of [
      { status: 401, headers: {}, body: {} },
      { status: 200, headers: {}, body: { data: 'wrong' } },
    ]) {
      const fake = fakeTransport(() => Effect.succeed(response));
      const exit = await Effect.runPromiseExit(
        createZestyApi(fake.transport).loadCollectionSnapshot(reference, 'latest', 'private-token'),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(JSON.stringify(exit)).not.toContain('private-token');
    }
  });

  it('stops at the collection limit and marks the snapshot partial', async () => {
    const data = Array.from({ length: 5 }, (_, index) => ({
      title: `Item ${index}`,
      meta: {
        zuid: `7-limit-${index}00000`,
        created: '2026-01-01T12:00:00.000Z',
        modified: '2026-01-01T12:00:00.000Z',
        version: 1,
      },
    }));
    const fake = fakeTransport(() =>
      Effect.succeed({
        status: 200,
        headers: {},
        body: { data, _meta: { totalResults: 20, page: 1, limit: 5 } },
      }),
    );

    const snapshot = await Effect.runPromise(
      createZestyApi(fake.transport, { collectionLimit: 3, pageSize: 5 }).loadCollectionSnapshot(
        reference,
        'latest',
        'private-token',
      ),
    );
    expect(snapshot.items).toHaveLength(3);
    expect(snapshot.partial).toBe(true);
    expect(fake.requests).toHaveLength(1);
  });

  it('uses the remaining view budget as the final page size', async () => {
    const fake = fakeTransport(() =>
      Effect.succeed({
        status: 200,
        headers: {},
        body: { ...fixtureCollectionPage, _meta: { totalResults: 20, start: 0, limit: 2 } },
      }),
    );
    const snapshot = await Effect.runPromise(
      createZestyApi(fake.transport, { pageSize: 2 }).loadCollectionSnapshot(
        reference,
        'latest',
        'private-token',
        3,
      ),
    );
    expect(snapshot.items).toHaveLength(3);
    expect(fake.requests[1]?.url).toContain('limit=1');
    expect(fake.requests).toHaveLength(2);
  });

  it('times out and remains interruptible', async () => {
    const fake = fakeTransport(() => Effect.never);
    const api = createZestyApi(fake.transport, { timeoutMs: 5 });
    const timeoutExit = await Effect.runPromiseExit(
      api.loadCollectionSnapshot(reference, 'latest', 'private-token'),
    );
    expect(Exit.isFailure(timeoutExit)).toBe(true);
    expect(JSON.stringify(timeoutExit)).toContain('timeout');

    const fiber = Effect.runFork(
      createZestyApi(fake.transport, { timeoutMs: 60_000 }).loadCollectionSnapshot(
        reference,
        'latest',
        'private-token',
      ),
    );
    const interrupted = await Effect.runPromise(Fiber.interrupt(fiber));
    expect(Exit.isInterrupted(interrupted)).toBe(true);
  });
});
