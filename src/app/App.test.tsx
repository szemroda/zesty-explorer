import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Effect, Either } from 'effect';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeCollectionPage,
  fixtureCollectionPage,
  safeRequestUrl,
  type CollectionCatalog,
  type CollectionSchema,
  type CollectionSnapshot,
  type Deployment,
  type ExplorerError,
  type PersistedView,
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

function tokenStore(initial: Iterable<readonly [Deployment, string]> = []): SessionTokenStore {
  const tokens = new Map(initial);
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
    loadItemVersions: () => Effect.succeed([]),
    loadItemPublishings: () => Effect.succeed([]),
    loadInstanceUsers: () => Effect.succeed([]),
    loadCodeFiles: (_instance, state) => Effect.succeed({ state, files: [], incomplete: false }),
  };
}

const rootWithChild = {
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

function openSharedView(root: PersistedView['root'], view: Partial<PersistedView> = {}) {
  window.history.replaceState(
    null,
    '',
    ViewCodec.encode({
      version: 3,
      instance: {
        instanceZuid: root.reference.instanceZuid,
        deployment: root.reference.deployment,
      },
      tab: 'explorer',
      view: {
        version: 2,
        root,
        contentState: 'latest',
        viewFilters: [],
        globalFreeText: '',
        ...view,
      },
    }).fragment,
  );
}

// Fills the start form and asks for the instance's collections.
function loadCollections(collectionUrl: string, token = 'fixture-session-token') {
  fireEvent.change(screen.getByLabelText('Zesty session token'), { target: { value: token } });
  fireEvent.change(screen.getByLabelText('Zesty instance URL'), {
    target: { value: collectionUrl },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Load collections' }));
}

async function submitStartForm(collectionUrl: string, token = 'fixture-session-token') {
  loadCollections(collectionUrl, token);
  fireEvent.click(await screen.findByRole('button', { name: 'Open root collection' }));
}

afterEach(() => {
  toast.dismiss();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('root collection browser', () => {
  it('loads the catalog and waits for root confirmation before loading content', async () => {
    const loadCollectionSnapshot = vi.fn<ZestyApi['loadCollectionSnapshot']>(() =>
      Effect.succeed(snapshot),
    );
    render(<App api={api(loadCollectionSnapshot)} tokenStore={tokenStore()} />);

    loadCollections('https://8-abc123.manager.zesty.io/content/6-model123');

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Root collection' })).toHaveValue('Stories'),
    );
    expect(loadCollectionSnapshot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open root collection' }));
    expect(await screen.findByRole('heading', { name: 'Stories' })).toBeInTheDocument();
  });

  it('shows a table placeholder while the root collection loads', async () => {
    render(<App api={api(() => Effect.never)} tokenStore={tokenStore()} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');

    expect(await screen.findByRole('status', { name: 'Loading collection' })).toBeInTheDocument();
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

    loadCollections('https://8-abc123.api.zesty.io/v1/content/models/6-model123');
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
    expect(
      within(screen.getByRole('dialog', { name: 'First story' })).getByText('7-000000-aaaaaa'),
    ).toBeInTheDocument();
    const zestyLink = screen.getByRole('link', {
      name: /open first story in zesty manager/i,
    });
    expect(zestyLink).toHaveAttribute(
      'href',
      'https://8-abc123.manager.zesty.io/content/6-model123/7-000000-aaaaaa',
    );
    expect(zestyLink).toHaveAttribute('target', '_blank');
    fireEvent.click(screen.getByRole('button', { name: 'Choose visible columns' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'workflowStatus' })).not.toBeChecked();
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

    loadCollections('https://8-abc123.manager.zesty.io/content/6-model123', 'expired-token');

    expect(
      await screen.findByRole('heading', { name: 'Replace your session token' }),
    ).toBeInTheDocument();
    expect(clear).toHaveBeenCalledWith('production');
  });

  it('requires a replacement token when item-history enrichment rejects its credentials', async () => {
    const store = tokenStore();
    const clear = vi.spyOn(store, 'clear');
    const testApi: ZestyApi = {
      ...api(),
      loadInstanceUsers: () =>
        Effect.fail({
          kind: 'authentication',
          status: 401,
          message: 'The Zesty session token is invalid or expired.',
        }),
    };
    render(<App api={testApi} tokenStore={store} />);
    await submitStartForm(
      'https://8-abc123.manager.zesty.io/content/6-model123/7-000000-aaaaaa/edit',
    );

    expect(
      await screen.findByRole('heading', { name: 'Replace your session token' }),
    ).toBeInTheDocument();
    expect(clear).toHaveBeenCalledWith('production');
    expect(screen.queryByRole('dialog', { name: 'First story' })).not.toBeInTheDocument();
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
    expect(await screen.findByText('Technical details copied')).toBeVisible();
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
    openSharedView(
      {
        ...rootWithChild,
        name: 'Saved stories',
        presentation: {
          visibleColumns: ['title'],
          columnWidths: { title: 320 },
          sort: { fieldPath: ['title'], direction: 'asc' },
          filters: [],
          freeText: 'First',
        },
        children: [],
      },
      { contentState: 'published', globalFreeText: 'story' },
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

  it('offers raw-data recovery and a reset for malformed links', () => {
    window.history.replaceState(null, '', '#view=truncated-data');
    render(<App api={api()} tokenStore={tokenStore()} />);

    expect(
      screen.getByRole('heading', { name: 'Shared view could not be restored' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(screen.getByRole('heading', { name: 'Open a Zesty collection' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(screen.queryByText('View reset')).not.toBeInTheDocument();
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
      expect(decoded.ok && decoded.state.view?.root.presentation.freeText).toBe('First');
    });
    expect(replaceState).toHaveBeenCalled();
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
      ...api(),
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
      ...api(),
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
      ...api(),
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

  it('rechecks permissions when a token is replaced for the same deployment', async () => {
    const usedTokens: string[] = [];
    const testApi = api((_reference, _state, sessionToken) => {
      usedTokens.push(sessionToken);
      return Effect.succeed(snapshot);
    });
    render(<App api={testApi} tokenStore={tokenStore()} />);
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123', 'first-token');
    await screen.findByRole('heading', { name: 'Stories' });
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear saved token' }));
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'Clear saved session token?',
    });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Clear token' }));
    await waitFor(() => expect(screen.getByLabelText('Zesty session token')).toHaveFocus());
    await submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123', 'second-token');
    await waitFor(() => expect(usedTokens).toEqual(['first-token', 'second-token']));
  });

  it('resumes descendant loading after a nested authentication failure', async () => {
    let childAttempts = 0;
    openSharedView(rootWithChild);
    const testApi: ZestyApi = {
      ...api(),
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

describe('confirmations and undo', () => {
  // Several toasts can be open at once, so the action is looked up inside its own toast.
  async function findToastAction(title: string, action: string) {
    const toast = (await screen.findByText(title)).closest('[data-sonner-toast]');
    if (!(toast instanceof HTMLElement)) throw new Error(`No toast titled ${title}`);
    return within(toast).getByRole('button', { name: action });
  }

  function openViewWithChild(testApi: ZestyApi = api()) {
    openSharedView(rootWithChild);
    render(<App api={testApi} tokenStore={storedTokenStore()} />);
  }

  it('removes a collection node at once and restores it with undo', async () => {
    openViewWithChild();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Related stories' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));

    expect(screen.queryByText('Related stories')).not.toBeInTheDocument();
    fireEvent.click(await findToastAction('Removed Related stories', 'Undo'));
    expect(await screen.findByText('Related stories')).toBeInTheDocument();
  });

  it('withdraws the undo offer once the tree changes again', async () => {
    openViewWithChild();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Related stories' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    await findToastAction('Removed Related stories', 'Undo');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Stories' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Rename Stories'), { target: { value: 'Articles' } });
    fireEvent.blur(screen.getByLabelText('Rename Stories'));

    await waitFor(() =>
      expect(screen.queryByText('Removed Related stories')).not.toBeInTheDocument(),
    );
  });

  it('resets the view at once and restores it with undo', async () => {
    openViewWithChild();
    await screen.findByRole('heading', { name: 'Stories' });
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset view' }));

    expect(screen.getByRole('heading', { name: 'Open a Zesty collection' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    fireEvent.click(await findToastAction('View reset', 'Undo'));
    expect(await screen.findByRole('heading', { name: 'Stories' })).toBeInTheDocument();
    expect(await screen.findByText('Related stories')).toBeInTheDocument();
    expect(window.location.hash).toMatch(/^#view=/);
  });

  it('withdraws the reset undo offer once a new collection setup starts', async () => {
    openViewWithChild();
    await screen.findByRole('heading', { name: 'Stories' });
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset view' }));
    await findToastAction('View reset', 'Undo');

    fireEvent.change(screen.getByLabelText('Zesty instance URL'), {
      target: { value: 'https://8-abc123.manager.zesty.io/content/6-model123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load collections' }));

    await waitFor(() => expect(screen.queryByText('View reset')).not.toBeInTheDocument());
  });

  it('asks before replacing the root and keeps the view when cancelled', async () => {
    const loadCollectionSnapshot = vi.fn<ZestyApi['loadCollectionSnapshot']>(() =>
      Effect.succeed(snapshot),
    );
    openViewWithChild(api(loadCollectionSnapshot));
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Stories' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change root collection' }));
    fireEvent.change(screen.getByLabelText('Root collection reference'), {
      target: { value: 'https://8-abc123.manager.zesty.io/content/6-other123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open root collection' }));

    const confirmation = await screen.findByRole('alertdialog', {
      name: 'Replace root collection?',
    });
    expect(
      within(confirmation)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Stories', 'Related stories']);
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Choose the root collection' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open root collection' }));
    fireEvent.click(
      within(
        await screen.findByRole('alertdialog', { name: 'Replace root collection?' }),
      ).getByRole('button', { name: 'Replace root' }),
    );
    await waitFor(() =>
      expect(
        loadCollectionSnapshot.mock.calls.some(
          ([reference]) => reference.modelZuid === '6-other123',
        ),
      ).toBe(true),
    );
  });
});

describe('form errors', () => {
  it('shows a start form problem on the field it belongs to and focuses it', () => {
    render(<App api={api()} tokenStore={tokenStore()} />);
    fireEvent.change(screen.getByLabelText('Zesty instance URL'), {
      target: { value: 'https://8-abc123.manager.zesty.io/content/6-model123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load collections' }));

    const token = screen.getByLabelText('Zesty session token');
    expect(token).toHaveAttribute('aria-invalid', 'true');
    expect(token).toHaveAccessibleDescription('Enter the Zesty session token for this deployment.');
    expect(token).toHaveFocus();

    fireEvent.change(token, { target: { value: 'fixture-session-token' } });
    fireEvent.change(screen.getByLabelText('Zesty instance URL'), {
      target: { value: 'https://example.com/content/6-model123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load collections' }));

    const instanceUrl = screen.getByLabelText('Zesty instance URL');
    expect(instanceUrl).toHaveAttribute('aria-invalid', 'true');
    expect(instanceUrl).toHaveFocus();
    expect(token).not.toHaveAttribute('aria-invalid', 'true');

    // A value that is not a URL at all still reaches the app's own field error.
    fireEvent.change(instanceUrl, { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load collections' }));
    expect(instanceUrl).toHaveAttribute('aria-invalid', 'true');
  });

  it('reports an unusable pasted root reference on its field instead of opening the selection', async () => {
    const loadCollectionSnapshot = vi.fn<ZestyApi['loadCollectionSnapshot']>(() =>
      Effect.succeed(snapshot),
    );
    render(<App api={api(loadCollectionSnapshot)} tokenStore={tokenStore()} />);
    loadCollections('https://8-abc123.manager.zesty.io/content/6-model123');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Root collection' })).toHaveValue('Stories'),
    );

    const pasted = screen.getByLabelText('Root collection reference');
    fireEvent.change(pasted, { target: { value: 'not a collection reference' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open root collection' }));
    expect(pasted).toHaveAttribute('aria-invalid', 'true');
    expect(pasted).toHaveFocus();

    fireEvent.change(pasted, {
      target: { value: 'https://8-zzz999.manager.zesty.io/content/6-model123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open root collection' }));
    expect(pasted).toHaveAccessibleDescription(
      'Paste a collection from the same Zesty instance and deployment.',
    );
    expect(loadCollectionSnapshot).not.toHaveBeenCalled();
  });

  it('asks for a root collection on the picker when none is chosen', async () => {
    render(<App api={api()} tokenStore={tokenStore()} />);
    loadCollections('https://8-abc123.manager.zesty.io/content/6-model123');
    // The picker remounts when its selection changes, so it is looked up again each time.
    const picker = () => screen.getByRole('combobox', { name: 'Root collection' });
    await waitFor(() => expect(picker()).toHaveValue('Stories'));

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open root collection' }));

    expect(picker()).toHaveAccessibleDescription(
      'Choose a root collection or paste a collection reference.',
    );
    expect(picker()).toHaveFocus();
  });

  it('asks for a missing relationship field path on that field', async () => {
    openSharedView(rootWithChild);
    render(<App api={api()} tokenStore={storedTokenStore()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Related stories' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Edit relationship for Related stories' }),
    );
    const parentPath = await screen.findByLabelText('Parent field path');
    fireEvent.change(parentPath, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save relationship' }));

    expect(parentPath).toHaveAttribute('aria-invalid', 'true');
    expect(parentPath).toHaveAccessibleDescription('Enter a parent field path.');
    expect(parentPath).toHaveFocus();
  });
});

describe('Code tab', () => {
  const source = '{{each stories as story}}{{story.title}}{{end-each}}';
  const codeApi: ZestyApi = {
    ...api(),
    loadCodeFiles: (instance, state) =>
      Effect.succeed({
        state,
        incomplete: false,
        files: [
          {
            id: '11-endpoint01',
            fileName: `/${instance.instanceZuid}.json`,
            type: 'ajax-json',
            code: source,
            version: 3,
          },
        ],
      }),
  };

  it('resets the Code tab when another instance is selected', async () => {
    render(<App api={codeApi} tokenStore={tokenStore()} />);
    loadCollections('https://8-abc123.manager.zesty.io/');
    fireEvent.click(await screen.findByRole('tab', { name: 'Code' }));
    fireEvent.click(await screen.findByRole('button', { name: /\/8-abc123\.json/ }));

    expect(await screen.findByRole('heading', { name: '/8-abc123.json' })).toBeInTheDocument();
    expect(ViewCodec.decode(window.location.hash)).toEqual({
      ok: true,
      state: {
        version: 3,
        instance: { instanceZuid: '8-abc123', deployment: 'production' },
        tab: 'code',
        codeSelection: { state: 'latest', fileId: '11-endpoint01' },
      },
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Explorer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    loadCollections('https://8-xyz789.manager.zesty.io/');
    fireEvent.click(await screen.findByRole('tab', { name: 'Code' }));

    expect(await screen.findByRole('button', { name: /\/8-xyz789\.json/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choose a file' })).toBeInTheDocument();
  });

  it('clears the saved token from the Code tab without an Explorer view', async () => {
    const store = tokenStore();
    const clear = vi.spyOn(store, 'clear');
    render(<App api={codeApi} tokenStore={store} />);
    loadCollections('https://8-abc123.manager.zesty.io/');
    fireEvent.click(await screen.findByRole('tab', { name: 'Code' }));
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Clear saved token' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear token' }));

    expect(clear).toHaveBeenCalledWith('production');
    expect(
      await screen.findByRole('heading', { name: 'Replace your session token' }),
    ).toBeInTheDocument();
  });

  it('resets both tabs from the Code tab and keeps the token', async () => {
    render(<App api={codeApi} tokenStore={tokenStore()} />);
    loadCollections('https://8-abc123.manager.zesty.io/');
    fireEvent.click(await screen.findByRole('tab', { name: 'Code' }));
    fireEvent.click(await screen.findByRole('button', { name: /\/8-abc123\.json/ }));
    await screen.findByRole('heading', { name: '/8-abc123.json' });
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reset view' }));

    expect(
      await screen.findByRole('heading', { name: 'Open a Zesty collection' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Zesty session token')).toHaveValue('fixture-session-token');
    expect(window.location.hash).toBe('');
    loadCollections('https://8-abc123.manager.zesty.io/');
    fireEvent.click(await screen.findByRole('tab', { name: 'Code' }));
    expect(await screen.findByRole('heading', { name: 'Choose a file' })).toBeInTheDocument();
  });
});
