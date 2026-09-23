import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Effect, Either } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeCollectionPage,
  fixtureCollectionPage,
  safeRequestUrl,
  type CollectionCatalog,
  type CollectionSchema,
  type CollectionSnapshot,
  type ExplorerError,
} from '../domain';
import type { SessionTokenStore } from '../view-codec';
import { ViewCodec } from '../view-codec';
import type { ZestyApi } from '../zesty-api';
import { App } from './App';

const decoded = decodeCollectionPage(fixtureCollectionPage);
if (Either.isLeft(decoded)) throw new Error('App test fixture must decode');

const schema: CollectionSchema = {
  modelZuid: '6-model123',
  label: 'Stories',
  fields: [
    { id: '12-title123', name: 'title', label: 'Title', kind: 'text' },
    { id: '12-score123', name: 'score', label: 'Score', kind: 'number' },
  ],
};

const snapshot: CollectionSnapshot = {
  id: 'snapshot-app-test',
  instanceZuid: '8-abc123',
  modelZuid: '6-model123',
  state: 'latest',
  language: 'en-US',
  items: decoded.right.items,
  itemsById: new Map(decoded.right.items.map((item) => [item.id, item])),
  partial: false,
};

const catalog: CollectionCatalog = {
  incomplete: false,
  collections: [
    {
      label: 'Stories',
      name: 'stories',
      type: 'pageset',
      group: 'content',
      reference: {
        instanceZuid: '8-abc123',
        modelZuid: '6-model123',
        deployment: 'production',
        area: 'content',
        apiBaseUrl: 'https://8-abc123.api.zesty.io/v1',
        managerBaseUrl: 'https://8-abc123.manager.zesty.io',
      },
    },
  ],
};

function tokenStore(): SessionTokenStore {
  const tokens = new Map<string, string>();
  return {
    read: (deployment) => tokens.get(deployment) ?? null,
    set: (deployment, token) => tokens.set(deployment, token),
    clear: (deployment) => tokens.delete(deployment),
  };
}

function storedTokenStore(token = 'stored-session-token'): SessionTokenStore {
  return {
    read: () => token,
    set: vi.fn(),
    clear: vi.fn(),
  };
}

function api(
  loadSnapshot: ZestyApi['loadCollectionSnapshot'] = () => Effect.succeed(snapshot),
): ZestyApi {
  return {
    loadCollectionCatalog: () => Effect.succeed(catalog),
    loadCollectionSchema: () => Effect.succeed(schema),
    loadCollectionSnapshot: loadSnapshot,
  };
}

async function submitStartForm(collectionUrl: string, token = 'fixture-session-token') {
  fireEvent.change(screen.getByLabelText('Zesty session token'), { target: { value: token } });
  fireEvent.change(screen.getByLabelText('Zesty instance URL'), {
    target: { value: collectionUrl },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Load collections' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open root collection' }));
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('root collection browser', () => {
  it('introduces the collection-opening workflow', () => {
    render(<App api={api()} tokenStore={tokenStore()} />);
    expect(screen.getByRole('heading', { name: 'Zesty Explorer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Open a Zesty collection' })).toBeInTheDocument();
  });

  it('loads the catalog and waits for root confirmation before loading content', async () => {
    const loadCollectionSnapshot = vi.fn<ZestyApi['loadCollectionSnapshot']>(() =>
      Effect.succeed(snapshot),
    );
    render(<App api={api(loadCollectionSnapshot)} tokenStore={tokenStore()} />);

    fireEvent.change(screen.getByLabelText('Zesty session token'), {
      target: { value: 'fixture-session-token' },
    });
    fireEvent.change(screen.getByLabelText('Zesty instance URL'), {
      target: { value: 'https://8-abc123.manager.zesty.io/content/6-model123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load collections' }));

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Root collection' })).toHaveValue('Stories'),
    );
    expect(loadCollectionSnapshot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open root collection' }));
    expect(await screen.findByRole('heading', { name: 'Stories' })).toBeInTheDocument();
  });

  it('opens the root picker directly from the root collection menu', async () => {
    render(<App api={api()} tokenStore={tokenStore()} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');
    await screen.findByRole('heading', { name: 'Stories' });

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Stories' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change root collection' }));

    expect(screen.getByRole('heading', { name: 'Choose the root collection' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Zesty instance URL')).not.toBeInTheDocument();
  });

  it('can open a recognized API model URL when the catalog is unavailable', async () => {
    const testApi: ZestyApi = {
      ...api(),
      loadCollectionCatalog: () =>
        Effect.fail({ kind: 'network', message: 'Catalog is unavailable.' }),
    };
    render(<App api={testApi} tokenStore={tokenStore()} />);

    fireEvent.change(screen.getByLabelText('Zesty session token'), {
      target: { value: 'fixture-session-token' },
    });
    fireEvent.change(screen.getByLabelText('Zesty instance URL'), {
      target: { value: 'https://8-abc123.api.zesty.io/v1/content/models/6-model123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load collections' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open root collection' }));

    expect(await screen.findByRole('heading', { name: 'Stories' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /in Zesty Manager/ })).not.toBeInTheDocument();
  });

  it('refreshes the catalog and open collections, then keeps a failure indicator until retry succeeds', async () => {
    let catalogAttempts = 0;
    const loadCollectionSnapshot = vi.fn<ZestyApi['loadCollectionSnapshot']>(() =>
      Effect.succeed(snapshot),
    );
    const testApi: ZestyApi = {
      ...api(loadCollectionSnapshot),
      loadCollectionCatalog: () => {
        catalogAttempts += 1;
        return catalogAttempts === 2
          ? Effect.fail({ kind: 'network', message: 'Catalog refresh failed.' })
          : Effect.succeed(catalog);
      },
    };
    render(<App api={testApi} tokenStore={tokenStore()} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');
    await screen.findByRole('heading', { name: 'Stories' });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect((await screen.findAllByText('Refresh failed')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('data-refresh-failed');
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAccessibleDescription(
      'The last refresh failed. Activate Refresh to retry.',
    );
    expect(loadCollectionSnapshot.mock.calls.length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh' })).not.toHaveAttribute(
        'data-refresh-failed',
      ),
    );
    expect(catalogAttempts).toBe(3);
  });

  it('opens an item URL, renders its collection, and opens item details', async () => {
    render(<App api={api()} tokenStore={tokenStore()} />);
    await submitStartForm(
      'https://8-abc123.manager.zesty.io/content/6-model123/7-000000-aaaaaa/edit',
    );

    expect(await screen.findByRole('heading', { name: 'Stories' })).toBeInTheDocument();
    const htmlCell = screen.getByRole('cell', { name: 'First story' });
    expect(htmlCell).toBeInTheDocument();
    expect(htmlCell.querySelector('strong')).toBeNull();
    expect(screen.getByRole('dialog', { name: '7-000000-aaaaaa' })).toBeInTheDocument();
    const zestyLink = screen.getByRole('link', {
      name: /open first story in zesty manager/i,
    });
    expect(zestyLink).toHaveAttribute(
      'href',
      'https://8-abc123.manager.zesty.io/content/6-model123/7-000000-aaaaaa',
    );
    expect(zestyLink).toHaveAttribute('target', '_blank');
    fireEvent.click(screen.getByRole('button', { name: 'Choose visible columns' }));
    expect(screen.getByRole('checkbox', { name: 'workflowStatus' })).not.toBeChecked();
  });

  it('clears an expired token, preserves the root, and resumes with a replacement', async () => {
    let attempts = 0;
    const store = tokenStore();
    const clear = vi.spyOn(store, 'clear');
    const testApi = api(() => {
      attempts += 1;
      return attempts === 1
        ? Effect.fail<ExplorerError>({
            kind: 'authentication',
            status: 401,
            message: 'The Zesty session token is invalid or expired.',
          })
        : Effect.succeed(snapshot);
    });
    render(<App api={testApi} tokenStore={store} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');

    expect(
      await screen.findByRole('heading', { name: 'Replace your session token' }),
    ).toBeInTheDocument();
    expect(clear).toHaveBeenCalledWith('production');
    expect(screen.getByLabelText('Zesty instance URL')).toHaveValue(
      'https://8-abc123.manager.zesty.io/content/6-model123',
    );

    await submitStartForm(
      'https://8-abc123.manager.zesty.io/content/6-model123',
      'replacement-token',
    );
    await waitFor(() => expect(attempts).toBe(2));
    expect(await screen.findByRole('heading', { name: 'Stories' })).toBeInTheDocument();
  });

  it('requires a replacement token when the catalog rejects its credentials', async () => {
    const store = tokenStore();
    const clear = vi.spyOn(store, 'clear');
    const testApi: ZestyApi = {
      ...api(),
      loadCollectionCatalog: () =>
        Effect.fail({
          kind: 'authentication',
          status: 401,
          message: 'The Zesty session token is invalid or expired.',
        }),
    };
    render(<App api={testApi} tokenStore={store} />);

    fireEvent.change(screen.getByLabelText('Zesty session token'), {
      target: { value: 'expired-token' },
    });
    fireEvent.change(screen.getByLabelText('Zesty instance URL'), {
      target: { value: 'https://8-abc123.manager.zesty.io/content/6-model123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load collections' }));

    expect(
      await screen.findByRole('heading', { name: 'Replace your session token' }),
    ).toBeInTheDocument();
    expect(clear).toHaveBeenCalledWith('production');
  });

  it('reveals and copies safe technical details for a root load failure', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const failure: ExplorerError = {
      kind: 'decoding',
      message: 'Zesty returned collection data in an unsupported shape.',
      diagnostic: {
        operation: 'load-collection-items',
        requestUrl: safeRequestUrl(
          'https://8-abc123.api.zesty.io/v1/content/models/6-model123/items?lang=en-US',
        ),
        responseStatus: 200,
        issues: [{ path: '$.data[0].meta.version', expected: 'number', received: 'string' }],
        issuesOmitted: true,
      },
    };
    render(<App api={api(() => Effect.fail(failure))} tokenStore={tokenStore()} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');

    expect(await screen.findByRole('heading', { name: 'Collection could not load' })).toBeVisible();
    expect(screen.queryByText('Loading collection items')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));

    const technicalDetails = screen.getByLabelText('Technical error details');
    expect(technicalDetails).toHaveTextContent('Loading collection items');
    expect(technicalDetails).toHaveTextContent('$.data[0].meta.version');
    fireEvent.click(screen.getByRole('button', { name: 'Copy technical details' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible());
    const expectedDetails = [
      'Error kind: decoding',
      'Operation: Loading collection items',
      'Request URL: https://8-abc123.api.zesty.io/v1/content/models/6-model123/items?lang=en-US',
      'HTTP status: 200',
      'Decoding issues:',
      '- $.data[0].meta.version: expected number, received string',
      'Further decoding issues were omitted.',
    ].join('\n');
    expect(technicalDetails.textContent).toBe(expectedDetails);
    expect(writeText).toHaveBeenCalledWith(expectedDetails);
    expect(writeText.mock.calls.flat().join('\n')).not.toContain('private-token');
  });

  it('restores a valid shared view before loading and keeps the token out of the URL', async () => {
    const root = {
      id: 'node-root',
      name: 'Saved stories',
      reference: {
        instanceZuid: '8-abc123',
        modelZuid: '6-model123',
        deployment: 'production',
        area: 'content',
        apiBaseUrl: 'https://8-abc123.api.zesty.io/v1',
        managerBaseUrl: 'https://8-abc123.manager.zesty.io',
      },
      presentation: {
        visibleColumns: ['title'],
        columnWidths: { title: 320 },
        sort: { fieldPath: ['title'], direction: 'asc' },
        filters: [],
        freeText: 'First',
      },
      children: [],
    } as const;
    window.history.replaceState(
      null,
      '',
      ViewCodec.encode({
        version: 2,
        root,
        contentState: 'published',
        viewFilters: [],
        globalFreeText: 'story',
      }).fragment,
    );

    render(<App api={api()} tokenStore={storedTokenStore()} />);

    expect(await screen.findByRole('heading', { name: 'Stories' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search the complete view')).toHaveValue('story');
    expect(screen.getByRole('button', { name: 'Published' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(window.location.hash).toMatch(/^#view=/);
    expect(window.location.href).not.toContain('stored-session-token');
  });

  it('offers raw-data recovery and a confirmed reset for malformed links', () => {
    window.history.replaceState(null, '', '#view=truncated-data');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App api={api()} tokenStore={tokenStore()} />);

    expect(
      screen.getByRole('heading', { name: 'Shared view could not be restored' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(screen.getByRole('heading', { name: 'Open a Zesty collection' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  it('synchronizes settled table state with replaceState', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    render(<App api={api()} tokenStore={tokenStore()} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');
    await screen.findByRole('heading', { name: 'Stories' });

    fireEvent.change(screen.getByLabelText('Filter this table'), {
      target: { value: 'First' },
    });

    await waitFor(() => {
      const decoded = ViewCodec.decode(window.location.hash);
      expect(decoded.ok && decoded.view.root.presentation.freeText).toBe('First');
    });
    expect(replaceState).toHaveBeenCalled();
  });

  it('detects and follows a native relationship declared by the nested collection', async () => {
    const articleSchema: CollectionSchema = {
      modelZuid: '6-articles123',
      label: 'Articles',
      fields: [{ id: '12-title123', name: 'title', label: 'Title', kind: 'text' }],
    };
    const commentSchema: CollectionSchema = {
      modelZuid: '6-comments123',
      label: 'Comments',
      fields: [
        {
          id: '12-article123',
          name: 'article',
          label: 'Article',
          kind: 'relationship',
          relatedModelZuid: '6-articles123',
        },
        { id: '12-body123', name: 'body', label: 'Body', kind: 'text' },
      ],
    };
    const articleItem = {
      ...snapshot.items[0]!,
      id: '7-article-000001' as const,
      fields: { title: 'First article' },
    };
    const commentItem = {
      ...snapshot.items[0]!,
      id: '7-comment-000001' as const,
      fields: { article: { zuid: articleItem.id }, body: 'First comment' },
    };
    const articleSnapshot: CollectionSnapshot = {
      ...snapshot,
      id: 'snapshot-articles',
      modelZuid: '6-articles123',
      items: [articleItem],
      itemsById: new Map([[articleItem.id, articleItem]]),
    };
    const commentSnapshot: CollectionSnapshot = {
      ...snapshot,
      id: 'snapshot-comments',
      modelZuid: '6-comments123',
      items: [commentItem],
      itemsById: new Map([[commentItem.id, commentItem]]),
    };
    const testApi: ZestyApi = {
      loadCollectionCatalog: () =>
        Effect.succeed({
          incomplete: false,
          collections: [
            {
              ...catalog.collections[0]!,
              label: 'Articles',
              name: 'articles',
              reference: {
                ...catalog.collections[0]!.reference,
                modelZuid: '6-articles123',
              },
            },
            {
              ...catalog.collections[0]!,
              label: 'Comments',
              name: 'comments',
              reference: {
                ...catalog.collections[0]!.reference,
                modelZuid: '6-comments123',
              },
            },
          ],
        }),
      loadCollectionSchema: (reference) =>
        Effect.succeed(
          reference.modelZuid === commentSchema.modelZuid ? commentSchema : articleSchema,
        ),
      loadCollectionSnapshot: (reference) =>
        Effect.succeed(
          reference.modelZuid === commentSchema.modelZuid ? commentSnapshot : articleSnapshot,
        ),
    };

    render(<App api={testApi} tokenStore={tokenStore()} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-articles123');
    await screen.findByRole('heading', { name: 'Articles' });

    fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show collections' }));
    fireEvent.click(await screen.findByRole('option', { name: /Comments.*6-comments123/ }));

    const nativeField = await screen.findByLabelText('Native field');
    expect(nativeField).toHaveTextContent('Article');
    expect(screen.getByLabelText('Node name')).toHaveAttribute(
      'placeholder',
      'Defaults to Comments',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add collection node' }));

    await within(screen.getByRole('complementary', { name: 'Collection tree' })).findByText(
      'Comments',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand relationships for 7-article-000001' }),
    );
    expect(await screen.findByRole('region', { name: 'Comments related items' })).toHaveTextContent(
      'First comment',
    );
  });

  it('uses the catalog label for a pasted related collection URL', async () => {
    const relatedCatalogEntry: CollectionCatalog['collections'][number] = {
      ...catalog.collections[0]!,
      label: 'Authors',
      name: 'authors',
      reference: {
        ...catalog.collections[0]!.reference,
        modelZuid: '6-authors123',
      },
    };
    const relatedSchema: CollectionSchema = {
      modelZuid: '6-authors123',
      label: '6-authors123',
      fields: [
        {
          id: '12-story123',
          name: 'story',
          label: 'Story',
          kind: 'relationship',
          relatedModelZuid: schema.modelZuid,
        },
      ],
    };
    const testApi: ZestyApi = {
      ...api(),
      loadCollectionCatalog: () =>
        Effect.succeed({
          collections: [...catalog.collections, relatedCatalogEntry],
          incomplete: false,
        }),
      loadCollectionSchema: (reference) =>
        Effect.succeed(reference.modelZuid === relatedSchema.modelZuid ? relatedSchema : schema),
    };
    render(<App api={testApi} tokenStore={tokenStore()} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');
    await screen.findByRole('heading', { name: 'Stories' });

    fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }));
    fireEvent.change(screen.getByLabelText('Related collection URL'), {
      target: { value: 'https://8-abc123.manager.zesty.io/content/6-authors123' },
    });

    expect(await screen.findByLabelText('Native field')).toHaveTextContent('Story');
    expect(screen.getByLabelText('Node name')).toHaveAttribute(
      'placeholder',
      'Defaults to Authors',
    );
    fireEvent.change(screen.getByLabelText('Node name'), {
      target: { value: '  Editorial authors  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add collection node' }));

    const nodeName = await within(
      screen.getByRole('complementary', { name: 'Collection tree' }),
    ).findByText('Editorial authors');
    expect(nodeName.textContent).toBe('Editorial authors');
  });

  it('uses the model ZUID when a pasted related collection is absent from the catalog', async () => {
    const relatedSchema: CollectionSchema = {
      modelZuid: '6-uncatalogued123',
      label: '6-uncatalogued123',
      fields: [
        {
          id: '12-story123',
          name: 'story',
          label: 'Story',
          kind: 'relationship',
          relatedModelZuid: schema.modelZuid,
        },
      ],
    };
    const testApi: ZestyApi = {
      ...api(),
      loadCollectionSchema: (reference) =>
        Effect.succeed(reference.modelZuid === relatedSchema.modelZuid ? relatedSchema : schema),
    };
    render(<App api={testApi} tokenStore={tokenStore()} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');
    await screen.findByRole('heading', { name: 'Stories' });

    fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }));
    fireEvent.change(screen.getByLabelText('Related collection URL'), {
      target: { value: 'https://8-abc123.manager.zesty.io/content/6-uncatalogued123' },
    });

    expect(await screen.findByLabelText('Native field')).toHaveTextContent('Story');
    expect(screen.getByLabelText('Node name')).toHaveAttribute(
      'placeholder',
      'Defaults to 6-uncatalogued123',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add collection node' }));

    expect(
      await within(screen.getByRole('complementary', { name: 'Collection tree' })).findByText(
        '6-uncatalogued123',
      ),
    ).toBeInTheDocument();
  });

  it('uses custom equality and the collection label when no native relationship exists', async () => {
    const relatedCatalogEntry: CollectionCatalog['collections'][number] = {
      ...catalog.collections[0]!,
      label: 'Authors',
      name: 'authors',
      type: 'future-kind',
      group: 'other',
      reference: {
        ...catalog.collections[0]!.reference,
        modelZuid: '6-authors123',
        area: 'other',
      },
    };
    const loadCollectionSchema = vi.fn<ZestyApi['loadCollectionSchema']>((reference) =>
      Effect.succeed({ ...schema, modelZuid: reference.modelZuid }),
    );
    const testApi: ZestyApi = {
      ...api(),
      loadCollectionCatalog: () =>
        Effect.succeed({
          collections: [...catalog.collections, relatedCatalogEntry],
          incomplete: false,
        }),
      loadCollectionSchema,
    };
    render(<App api={testApi} tokenStore={tokenStore()} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');
    await screen.findByRole('heading', { name: 'Stories' });

    fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show collections' }));
    fireEvent.click(await screen.findByRole('option', { name: /Authors.*6-authors123/ }));

    expect(
      await screen.findByText(
        'No native relationship targets this collection. Custom equality is selected.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Child field path')).toHaveValue('id');
    expect(loadCollectionSchema).toHaveBeenCalledWith(
      expect.objectContaining({ modelZuid: '6-authors123', area: 'other' }),
      'fixture-session-token',
    );
    fireEvent.change(screen.getByLabelText('Parent field path'), { target: { value: 'id' } });
    fireEvent.change(screen.getByLabelText('Node name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add collection node' }));

    expect(
      await within(screen.getByRole('complementary', { name: 'Collection tree' })).findByText(
        'Authors',
      ),
    ).toBeInTheDocument();
  });

  it('rejects a related collection from another instance before loading its schema', async () => {
    const loadCollectionSchema = vi.fn<ZestyApi['loadCollectionSchema']>(() =>
      Effect.succeed(schema),
    );
    const testApi: ZestyApi = {
      loadCollectionCatalog: () => Effect.succeed({ collections: [], incomplete: false }),
      loadCollectionSchema,
      loadCollectionSnapshot: () => Effect.succeed(snapshot),
    };
    render(<App api={testApi} tokenStore={tokenStore()} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');
    await screen.findByRole('heading', { name: 'Stories' });

    fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }));
    fireEvent.change(screen.getByLabelText('Related collection URL'), {
      target: { value: 'https://8-foreign.manager.zesty.io/content/6-foreign123' },
    });
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(loadCollectionSchema).toHaveBeenCalledTimes(1);
  });

  it('cancels related schema inspection when the add dialog closes', async () => {
    let interrupted = false;
    const testApi: ZestyApi = {
      loadCollectionCatalog: () => Effect.succeed({ collections: [], incomplete: false }),
      loadCollectionSchema: (reference) =>
        reference.modelZuid === schema.modelZuid
          ? Effect.succeed(schema)
          : Effect.never.pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted = true;
                }),
              ),
            ),
      loadCollectionSnapshot: () => Effect.succeed(snapshot),
    };
    render(<App api={testApi} tokenStore={tokenStore()} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');
    await screen.findByRole('heading', { name: 'Stories' });

    fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }));
    fireEvent.change(screen.getByLabelText('Related collection URL'), {
      target: { value: 'https://8-abc123.manager.zesty.io/content/6-related123' },
    });
    await screen.findByText('Checking native relationships…');
    fireEvent.click(screen.getByRole('button', { name: 'Close add relationship' }));

    await waitFor(() => expect(interrupted).toBe(true));
  });

  it('requires retry when native relationship inspection fails', async () => {
    const rootSchema: CollectionSchema = {
      modelZuid: '6-model123',
      label: 'Stories',
      fields: [],
    };
    const relatedSchema: CollectionSchema = {
      modelZuid: '6-related123',
      label: 'Related',
      fields: [
        {
          id: '12-story123',
          name: 'story',
          label: 'Story',
          kind: 'relationship',
          relatedModelZuid: rootSchema.modelZuid,
        },
      ],
    };
    let relatedAttempts = 0;
    const testApi: ZestyApi = {
      loadCollectionCatalog: () => Effect.succeed({ collections: [], incomplete: false }),
      loadCollectionSchema: (reference) => {
        if (reference.modelZuid === rootSchema.modelZuid) return Effect.succeed(rootSchema);
        relatedAttempts += 1;
        return relatedAttempts === 1
          ? Effect.fail({ kind: 'network', message: 'Offline' })
          : Effect.succeed(relatedSchema);
      },
      loadCollectionSnapshot: () => Effect.succeed(snapshot),
    };
    render(<App api={testApi} tokenStore={tokenStore()} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');
    await screen.findByRole('heading', { name: 'Stories' });

    fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }));
    fireEvent.change(screen.getByLabelText('Related collection URL'), {
      target: { value: 'https://8-abc123.manager.zesty.io/content/6-related123' },
    });

    const retry = await screen.findByRole('button', { name: 'Retry schema inspection' });
    expect(screen.getByRole('button', { name: 'Add collection node' })).toBeDisabled();
    fireEvent.click(retry);
    expect(await screen.findByLabelText('Native field')).toHaveTextContent('Story');
  });

  it('does not load with replacement credentials until the new root is submitted', async () => {
    const tokens = new Map([
      ['production', 'production-token'],
      ['stage', 'stage-token'],
    ]);
    const store: SessionTokenStore = {
      read: (deployment) => tokens.get(deployment) ?? null,
      set: (deployment, value) => tokens.set(deployment, value),
      clear: (deployment) => tokens.delete(deployment),
    };
    const requests: string[] = [];
    const testApi = api((reference, _state, sessionToken) => {
      requests.push(`${reference.deployment}:${sessionToken}`);
      return Effect.succeed(snapshot);
    });
    render(<App api={testApi} tokenStore={store} />);
    await submitStartForm(
      'https://8-abc123.manager.zesty.io/content/6-model123',
      'production-token',
    );
    await screen.findByRole('heading', { name: 'Stories' });
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change view setup' }));
    fireEvent.change(screen.getByLabelText('Zesty instance URL'), {
      target: { value: 'https://8-abc123.manager.stage.zesty.io/content/6-model123' },
    });
    expect(screen.getByLabelText('Zesty session token')).toHaveValue('stage-token');
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(requests).toEqual(['production:production-token']);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(requests).toEqual(['production:production-token']);
    expect(screen.getByRole('heading', { name: 'Stories' })).toBeInTheDocument();
  });

  it('rechecks permissions when a token is replaced for the same deployment', async () => {
    const usedTokens: string[] = [];
    const testApi = api((_reference, _state, sessionToken) => {
      usedTokens.push(sessionToken);
      return Effect.succeed(snapshot);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App api={testApi} tokenStore={tokenStore()} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123', 'first-token');
    await screen.findByRole('heading', { name: 'Stories' });
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear saved token' }));
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123', 'second-token');
    await waitFor(() => expect(usedTokens).toEqual(['first-token', 'second-token']));
  });

  it('resumes descendant loading after a nested authentication failure', async () => {
    let childAttempts = 0;
    const root = {
      id: 'node-root',
      name: 'Stories',
      reference: {
        instanceZuid: '8-abc123',
        modelZuid: '6-model123',
        deployment: 'production',
        area: 'content',
        apiBaseUrl: 'https://8-abc123.api.zesty.io/v1',
        managerBaseUrl: 'https://8-abc123.manager.zesty.io',
      },
      presentation: {
        visibleColumns: ['*'],
        columnWidths: {},
        sort: { fieldPath: ['modified'], direction: 'desc' },
        filters: [],
        freeText: '',
      },
      children: [
        {
          id: 'node-child',
          name: 'Related stories',
          reference: {
            instanceZuid: '8-abc123',
            modelZuid: '6-child123',
            deployment: 'production',
            area: 'content',
            apiBaseUrl: 'https://8-abc123.api.zesty.io/v1',
            managerBaseUrl: 'https://8-abc123.manager.zesty.io',
          },
          relationship: {
            kind: 'custom',
            parentField: ['title'],
            childField: ['title'],
          },
          presentation: {
            visibleColumns: ['*'],
            columnWidths: {},
            sort: { fieldPath: ['modified'], direction: 'desc' },
            filters: [],
            freeText: '',
          },
          children: [],
        },
      ],
    } as const;
    window.history.replaceState(
      null,
      '',
      ViewCodec.encode({
        version: 2,
        root,
        contentState: 'latest',
        viewFilters: [],
        globalFreeText: '',
      }).fragment,
    );
    const testApi: ZestyApi = {
      loadCollectionCatalog: () => Effect.succeed({ collections: [], incomplete: false }),
      loadCollectionSchema: (reference) =>
        Effect.succeed({ ...schema, modelZuid: reference.modelZuid }),
      loadCollectionSnapshot: (reference) => {
        if (reference.modelZuid !== '6-child123') return Effect.succeed(snapshot);
        childAttempts += 1;
        return childAttempts === 1
          ? Effect.fail({
              kind: 'authentication',
              status: 401,
              message: 'Expired',
            })
          : Effect.succeed({ ...snapshot, modelZuid: '6-child123' });
      },
    };
    render(<App api={testApi} tokenStore={storedTokenStore()} />);
    await screen.findByRole('heading', { name: 'Replace your session token' });
    await submitStartForm(
      'https://8-abc123.manager.zesty.io/content/6-model123',
      'replacement-token',
    );
    await waitFor(() => expect(childAttempts).toBe(2));
    expect(await screen.findByRole('heading', { name: 'Stories' })).toBeInTheDocument();
  });
});
