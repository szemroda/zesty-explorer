import { Effect, Exit, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';
import { fixtureCollectionPage } from '../domain';
import { parseCollectionReference, parseInstanceReference } from '../collection-reference';
import { createZestyApi, type ZestyTransport, type ZestyTransportRequest } from './index';

const parsedReference = parseCollectionReference(
  'https://8-abc123.manager.zesty.io/content/6-model123',
);
if (!parsedReference.ok) throw new Error('Test reference must parse');
const reference = parsedReference.value;
const itemReference = { ...reference, itemZuid: '7-documented-item' } as const;
const parsedInstance = parseInstanceReference('https://8-abc123.manager.zesty.io/');
if (!parsedInstance.ok) throw new Error('Test instance must parse');
const instance = parsedInstance.value;

const authenticatedGet = {
  method: 'GET',
  headers: { authorization: 'Bearer private-token', accept: 'application/json' },
} as const;

// Records every request and answers it with the handler's result for that attempt (1-based).
function fakeTransport(
  handler: (
    request: ZestyTransportRequest,
    attempt: number,
  ) => ReturnType<ZestyTransport['request']>,
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

// Answers every request with the same response.
function respondWith(body: unknown, status = 200) {
  return fakeTransport(() => Effect.succeed({ status, headers: {}, body }));
}

describe('ZestyApi', () => {
  it('loads the complete collection catalog with an authenticated GET', async () => {
    const fake = respondWith({
      data: [
        { ZUID: '6-stories123', label: 'Stories', name: 'stories', type: 'pageset' },
        { ZUID: '6-blocks123', label: 'Hero blocks', name: 'hero_blocks', type: 'block' },
        { ZUID: '6-custom123', label: 'Custom', name: 'custom', type: 'future-kind' },
      ],
    });

    const catalog = await Effect.runPromise(
      createZestyApi(fake.transport).loadCollectionCatalog(instance, 'private-token'),
    );

    expect(
      catalog.collections.map(({ label, name, type, group, reference }) => ({
        label,
        name,
        type,
        group,
        modelZuid: reference.modelZuid,
        area: reference.area,
      })),
    ).toEqual([
      {
        label: 'Stories',
        name: 'stories',
        type: 'pageset',
        group: 'content',
        modelZuid: '6-stories123',
        area: 'content',
      },
      {
        label: 'Hero blocks',
        name: 'hero_blocks',
        type: 'block',
        group: 'blocks',
        modelZuid: '6-blocks123',
        area: 'blocks',
      },
      {
        label: 'Custom',
        name: 'custom',
        type: 'future-kind',
        group: 'other',
        modelZuid: '6-custom123',
        area: 'other',
      },
    ]);
    expect(catalog.incomplete).toBe(false);
    expect(fake.requests).toEqual([
      { ...authenticatedGet, url: 'https://8-abc123.api.zesty.io/v1/content/models' },
    ]);
  });

  it('keeps valid collections when individual catalog records are malformed', async () => {
    const fake = respondWith({
      data: [
        { ZUID: '6-stories123', label: 'Stories', name: 'stories', type: 'dataset' },
        { ZUID: 42, label: false, name: 'broken', type: null },
      ],
    });

    const catalog = await Effect.runPromise(
      createZestyApi(fake.transport).loadCollectionCatalog(instance, 'private-token'),
    );

    expect(catalog.collections).toHaveLength(1);
    expect(catalog.incomplete).toBe(true);
    expect(catalog.warning).toMatchObject({
      kind: 'decoding',
      diagnostic: {
        operation: 'load-collection-catalog',
        requestUrl: 'https://8-abc123.api.zesty.io/v1/content/models',
        responseStatus: 200,
      },
    });
    expect(catalog.warning?.diagnostic?.issues?.[0]?.path).toBe('$.data[1].ZUID');
    expect(JSON.stringify(catalog.warning)).not.toContain('private-token');
  });

  it('loads a collection schema with an authenticated GET and maps Zesty datatypes', async () => {
    const fake = respondWith({
      data: [
        { ZUID: '12-title123', name: 'title', label: 'Title', datatype: 'text' },
        {
          ZUID: '12-author12',
          name: 'author',
          label: 'Author',
          datatype: 'one-to-one',
          relatedModelZUID: '6-author123',
        },
        {
          ZUID: '12-editor12',
          name: 'editor',
          label: 'Editor',
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
        {
          ZUID: '12-category1',
          name: 'category',
          label: 'Category',
          datatype: 'dropdown',
          relatedModelZUID: null,
          options: null,
          settings: { options: { news: 'News', guide: 'Guide' } },
        },
      ],
    });

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
      {
        id: '12-editor12',
        name: 'editor',
        label: 'Editor',
        kind: 'relationship',
        relatedModelZuid: '6-author123',
      },
      { id: '12-featured', name: 'featured', label: 'Featured', kind: 'boolean' },
      {
        id: '12-category1',
        name: 'category',
        label: 'Category',
        kind: 'text',
        options: ['news', 'guide'],
      },
    ]);
    expect(fake.requests).toEqual([
      {
        ...authenticatedGet,
        url: 'https://8-abc123.api.zesty.io/v1/content/models/6-model123/fields?lang=en-US',
      },
    ]);
  });

  it('rejects malformed schema ZUIDs before branding them', async () => {
    const fake = respondWith({
      data: [{ ZUID: 'wrong', name: 'title', label: 'Title', datatype: 'text' }],
    });

    const error = await Effect.runPromise(
      Effect.flip(createZestyApi(fake.transport).loadCollectionSchema(reference, 'private-token')),
    );

    expect(error.diagnostic?.issues?.[0]).toEqual({
      path: '$.data[0].ZUID',
      expected: 'string matching required format',
      received: 'string',
    });
  });

  it('describes an unsupported schema shape without exposing response values', async () => {
    const fake = respondWith({
      data: Array.from({ length: 25 }, () => ({
        ZUID: 123,
        name: 456,
        label: false,
        datatype: null,
        customerSecret: 'private-content-value',
      })),
    });

    const error = await Effect.runPromise(
      Effect.flip(createZestyApi(fake.transport).loadCollectionSchema(reference, 'private-token')),
    );

    expect(error).toMatchObject({
      kind: 'decoding',
      diagnostic: {
        operation: 'load-collection-schema',
        requestUrl: 'https://8-abc123.api.zesty.io/v1/content/models/6-model123/fields?lang=en-US',
        responseStatus: 200,
        issuesOmitted: true,
      },
    });
    expect(error.diagnostic?.issues).toHaveLength(20);
    expect(error.diagnostic?.issues?.slice(0, 2)).toEqual([
      { path: '$.data[0].ZUID', expected: 'string', received: 'number' },
      { path: '$.data[0].name', expected: 'string', received: 'number' },
    ]);
    expect(JSON.stringify(error)).not.toContain('private-content-value');
    expect(JSON.stringify(error)).not.toContain('private-token');
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
      data: { title: 'Documented response', featured: true },
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
    const fake = respondWith({
      data: [rawItem],
      _meta: { totalResults: 1, start: 0, offset: 0, limit: 2_500 },
    });

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

  it('loads complete content item versions with save metadata', async () => {
    const rawVersion = {
      data: { title: 'Earlier title' },
      meta: {
        ZUID: '7-documented-item',
        createdAt: '2026-01-03T12:00:00.000Z',
        updatedAt: '2026-02-03T12:00:00.000Z',
        version: 2,
      },
      web: {
        versionZUID: '9-version-two',
        createdAt: '2026-02-03T12:00:00.000Z',
        createdByUserZUID: '5-author-one',
      },
    };
    const fake = respondWith({ data: [rawVersion] });

    const versions = await Effect.runPromise(
      createZestyApi(fake.transport).loadItemVersions(itemReference, 'private-token'),
    );

    expect(versions).toEqual([
      {
        number: 2,
        savedAt: '2026-02-03T12:00:00.000Z',
        authorZuid: '5-author-one',
        item: {
          id: '7-documented-item',
          fields: { title: 'Earlier title' },
          metadata: {
            created: '2026-01-03T12:00:00.000Z',
            modified: '2026-02-03T12:00:00.000Z',
            version: 2,
          },
          raw: rawVersion,
        },
      },
    ]);
    expect(fake.requests).toEqual([
      {
        ...authenticatedGet,
        url: 'https://8-abc123.api.zesty.io/v1/content/models/6-model123/items/7-documented-item/versions',
      },
    ]);
  });

  it('loads publishing records used for current and scheduled version statuses', async () => {
    const fake = respondWith({
      data: [
        {
          ZUID: '25-active-publishing',
          version: 2,
          versionZUID: '9-version-two',
          publishAt: '2026-02-03T12:00:00.000Z',
          unpublishAt: null,
          _active: true,
        },
        {
          ZUID: '25-scheduled-publishing',
          version: 3,
          versionZUID: '9-version-three',
          publishAt: '2026-10-03T12:00:00.000Z',
          unpublishAt: null,
          _active: false,
        },
      ],
    });

    const publishings = await Effect.runPromise(
      createZestyApi(fake.transport).loadItemPublishings(itemReference, 'private-token'),
    );

    expect(publishings).toEqual([
      { version: 2, publishAt: '2026-02-03T12:00:00.000Z', active: true },
      { version: 3, publishAt: '2026-10-03T12:00:00.000Z', active: false },
    ]);
    expect(fake.requests[0]?.url).toBe(
      'https://8-abc123.api.zesty.io/v1/content/models/6-model123/items/7-documented-item/publishings',
    );
  });

  it('loads instance users from the deployment-specific Accounts API', async () => {
    const fake = respondWith({
      data: [
        { ZUID: '5-author-one', firstName: 'Casey', lastName: 'Ng', email: 'casey@example.test' },
        {
          ZUID: '55-service-account',
          firstName: 'Service',
          lastName: 'Account',
          email: 'service@example.test',
        },
      ],
    });

    const users = await Effect.runPromise(
      createZestyApi(fake.transport).loadInstanceUsers(instance, 'private-token'),
    );

    expect(users).toEqual([
      { id: '5-author-one', firstName: 'Casey', lastName: 'Ng', email: 'casey@example.test' },
      {
        id: '55-service-account',
        firstName: 'Service',
        lastName: 'Account',
        email: 'service@example.test',
      },
    ]);
    expect(fake.requests[0]?.url).toBe('https://accounts.api.zesty.io/v1/instances/8-abc123/users');
  });

  it('loads code files for the requested code state and keeps unknown file types', async () => {
    const fake = respondWith({
      _meta: { totalResults: 3 },
      data: [
        {
          ZUID: '11-endpoint123',
          fileName: '/data/articles.json',
          type: 'ajax-json',
          code: '[{{each articles as a}}{{end-each}}]',
          version: 7,
          updatedAt: '2026-08-25T20:07:48Z',
          contentModelZUID: null,
          active: 1,
        },
        {
          ZUID: '11-template123',
          fileName: 'articles',
          type: 'templateset',
          code: null,
          version: 2,
          contentModelZUID: '6-articles123',
        },
        {
          ZUID: '11-future12345',
          fileName: 'loader',
          type: 'future-kind',
          code: '',
          version: 1,
          contentModelZUID: 'not-a-model',
        },
      ],
    });

    const list = await Effect.runPromise(
      createZestyApi(fake.transport).loadCodeFiles(instance, 'published', 'private-token'),
    );

    expect(fake.requests[0]).toEqual({
      ...authenticatedGet,
      url: 'https://8-abc123.api.zesty.io/v1/web/views?status=live',
    });
    expect(list).toEqual({
      state: 'published',
      incomplete: false,
      files: [
        {
          id: '11-endpoint123',
          fileName: '/data/articles.json',
          type: 'ajax-json',
          code: '[{{each articles as a}}{{end-each}}]',
          version: 7,
          updatedAt: '2026-08-25T20:07:48Z',
        },
        {
          id: '11-template123',
          fileName: 'articles',
          type: 'templateset',
          code: '',
          version: 2,
          contentModelZuid: '6-articles123',
        },
        { id: '11-future12345', fileName: 'loader', type: 'future-kind', code: '', version: 1 },
      ],
    });
  });

  it('omits unreadable code file records without exposing their source', async () => {
    const fake = respondWith({
      data: [
        { ZUID: '11-endpoint123', fileName: '/ok.json', type: 'ajax-json', code: '', version: 1 },
        {
          ZUID: '11-broken1234',
          fileName: '/broken',
          type: 'ajax-json',
          code: 'SECRET',
          version: '2',
        },
      ],
    });

    const list = await Effect.runPromise(
      createZestyApi(fake.transport).loadCodeFiles(instance, 'latest', 'private-token'),
    );

    expect(fake.requests[0]?.url).toBe('https://8-abc123.api.zesty.io/v1/web/views?status=dev');
    expect(list.files.map((file) => file.id)).toEqual(['11-endpoint123']);
    expect(list.incomplete).toBe(true);
    expect(list.warning).toMatchObject({
      kind: 'decoding',
      diagnostic: {
        operation: 'load-code-files',
        issues: [{ path: '$.data[1].version', expected: 'number', received: 'string' }],
      },
    });
    expect(JSON.stringify(list.warning)).not.toContain('SECRET');
  });

  it('describes code file permission failures without naming collections', async () => {
    const fake = respondWith({ error: 'forbidden' }, 403);
    const error = await Effect.runPromise(
      Effect.flip(createZestyApi(fake.transport).loadCodeFiles(instance, 'latest', 'token')),
    );
    expect(error).toMatchObject({
      kind: 'permission',
      message: 'Your Zesty session cannot read code files in this instance.',
      diagnostic: { operation: 'load-code-files', responseStatus: 403 },
    });
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

    const forbidden = respondWith({ error: 'forbidden' }, 403);
    const error = await Effect.runPromise(
      Effect.flip(
        createZestyApi(forbidden.transport, { retryDelaysMs: [0, 0] }).loadCollectionSnapshot(
          reference,
          'latest',
          'private-token',
        ),
      ),
    );
    expect(error).toMatchObject({
      kind: 'permission',
      diagnostic: { operation: 'load-collection-items', responseStatus: 403 },
    });
    expect(forbidden.requests).toHaveLength(1);
  });

  it.each([
    { status: 401, body: {}, kind: 'authentication' },
    { status: 200, body: { data: 'wrong' }, kind: 'decoding' },
  ])(
    'maps a $status response to a $kind failure without exposing the token',
    async ({ status, body, kind }) => {
      const fake = respondWith(body, status);

      const error = await Effect.runPromise(
        Effect.flip(
          createZestyApi(fake.transport).loadCollectionSnapshot(
            reference,
            'latest',
            'private-token',
          ),
        ),
      );

      expect(error.kind).toBe(kind);
      expect(JSON.stringify(error)).not.toContain('private-token');
    },
  );

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
    const fake = respondWith({ data, _meta: { totalResults: 20, page: 1, limit: 5 } });

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
    const fake = respondWith({
      ...fixtureCollectionPage,
      _meta: { totalResults: 20, start: 0, limit: 2 },
    });

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
    const error = await Effect.runPromise(
      Effect.flip(
        createZestyApi(fake.transport, { timeoutMs: 5 }).loadCollectionSnapshot(
          reference,
          'latest',
          'private-token',
        ),
      ),
    );
    expect(error.kind).toBe('timeout');

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
