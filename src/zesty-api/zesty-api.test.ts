import { Effect, Either, Exit, Fiber } from 'effect';
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

  it('loads fields with nullable relationships and settings-based options', async () => {
    const fake = fakeTransport(() =>
      Effect.succeed({
        status: 200,
        headers: {},
        body: {
          data: [
            {
              ZUID: '12-category1',
              name: 'category',
              label: 'Category',
              datatype: 'dropdown',
              relatedModelZUID: null,
              options: null,
              settings: {
                options: {
                  news: 'News',
                  guide: 'Guide',
                },
              },
            },
          ],
        },
      }),
    );

    const schema = await Effect.runPromise(
      createZestyApi(fake.transport).loadCollectionSchema(reference, 'private-token'),
    );

    expect(schema.fields).toEqual([
      {
        id: '12-category1',
        name: 'category',
        label: 'Category',
        kind: 'text',
        options: ['news', 'guide'],
      },
    ]);
  });

  it('maps Zesty relationship and yes-no datatypes', async () => {
    const fake = fakeTransport(() =>
      Effect.succeed({
        status: 200,
        headers: {},
        body: {
          data: [
            {
              ZUID: '12-author12',
              name: 'author',
              label: 'Author',
              datatype: 'one_to_one',
              relatedModelZUID: '6-author123',
            },
            {
              ZUID: '12-featured',
              name: 'featured',
              label: 'Featured',
              datatype: 'yes_no',
              relatedModelZUID: null,
            },
          ],
        },
      }),
    );

    const schema = await Effect.runPromise(
      createZestyApi(fake.transport).loadCollectionSchema(reference, 'private-token'),
    );

    expect(schema.fields.map(({ name, kind }) => ({ name, kind }))).toEqual([
      { name: 'author', kind: 'relationship' },
      { name: 'featured', kind: 'boolean' },
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
    const result = await Effect.runPromise(
      Effect.either(
        createZestyApi(fake.transport).loadCollectionSchema(reference, 'private-token'),
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) return;
    expect(result.left.diagnostic?.issues?.[0]).toEqual({
      path: '$.data[0].ZUID',
      expected: 'string matching required format',
      received: 'string',
    });
  });

  it('describes an unsupported schema shape without exposing response values', async () => {
    const fake = fakeTransport(() =>
      Effect.succeed({
        status: 200,
        headers: {},
        body: {
          data: Array.from({ length: 25 }, () => ({
            ZUID: 123,
            name: 456,
            label: false,
            datatype: null,
            customerSecret: 'private-content-value',
          })),
        },
      }),
    );

    const result = await Effect.runPromise(
      Effect.either(
        createZestyApi(fake.transport).loadCollectionSchema(reference, 'private-token'),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) return;
    expect(result.left).toMatchObject({
      kind: 'decoding',
      diagnostic: {
        operation: 'load-collection-schema',
        requestUrl: 'https://8-abc123.api.zesty.io/v1/content/models/6-model123/fields?lang=en-US',
        responseStatus: 200,
        issuesOmitted: true,
      },
    });
    expect(result.left.diagnostic?.issues).toHaveLength(20);
    expect(result.left.diagnostic?.issues?.slice(0, 2)).toEqual([
      { path: '$.data[0].ZUID', expected: 'string', received: 'number' },
      { path: '$.data[0].name', expected: 'string', received: 'number' },
    ]);
    expect(JSON.stringify(result.left)).not.toContain('private-content-value');
    expect(JSON.stringify(result.left)).not.toContain('private-token');
  });

  it('loads all pages, applies published state, and normalizes once', async () => {
    const secondPage = {
      data: [
        {
          data: { title: 'Third story' },
          meta: {
            ZUID: '7-000000-cccccc',
            createdAt: '2026-01-03T12:00:00.000Z',
            updatedAt: '2026-02-03T12:00:00.000Z',
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

  it('normalizes the documented Zesty content item response', async () => {
    const rawItem = {
      data: {
        title: 'Documented response',
        featured: true,
      },
      meta: {
        ZUID: '7-documented-item',
        contentModelZUID: '6-model123',
        createdAt: '2026-01-03T12:00:00.000Z',
        updatedAt: '2026-02-03T12:00:00.000Z',
        version: 3,
        workflowStatus: 'ready',
      },
      siblings: {},
      web: { path: '/documented-response/' },
    };
    const fake = fakeTransport(() =>
      Effect.succeed({
        status: 200,
        headers: {},
        body: {
          data: [rawItem],
          _meta: { totalResults: 1, start: 0, offset: 0, limit: 2_500 },
        },
      }),
    );

    const snapshot = await Effect.runPromise(
      createZestyApi(fake.transport).loadCollectionSnapshot(reference, 'latest', 'private-token'),
    );

    expect(snapshot.items).toEqual([
      {
        id: '7-documented-item',
        fields: { title: 'Documented response', featured: true },
        metadata: {
          contentModelZUID: '6-model123',
          created: '2026-01-03T12:00:00.000Z',
          modified: '2026-02-03T12:00:00.000Z',
          version: 3,
          workflowStatus: 'ready',
        },
        raw: rawItem,
      },
    ]);
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
    const forbiddenResult = await Effect.runPromise(
      Effect.either(
        createZestyApi(forbidden.transport, { retryDelaysMs: [0, 0] }).loadCollectionSnapshot(
          reference,
          'latest',
          'private-token',
        ),
      ),
    );
    expect(Either.isLeft(forbiddenResult)).toBe(true);
    if (Either.isRight(forbiddenResult)) return;
    expect(forbiddenResult.left).toMatchObject({
      kind: 'permission',
      diagnostic: {
        operation: 'load-collection-items',
        responseStatus: 403,
      },
    });
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
      data: { title: `Item ${index}` },
      meta: {
        ZUID: `7-limit-${index}00000`,
        createdAt: '2026-01-01T12:00:00.000Z',
        updatedAt: '2026-01-01T12:00:00.000Z',
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
