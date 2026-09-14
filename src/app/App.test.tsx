import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Effect, Either } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeCollectionPage,
  fixtureCollectionPage,
  safeRequestUrl,
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
    loadCollectionSchema: () => Effect.succeed(schema),
    loadCollectionSnapshot: loadSnapshot,
  };
}

function submitStartForm(collectionUrl: string, token = 'fixture-session-token') {
  fireEvent.change(screen.getByLabelText('Zesty session token'), { target: { value: token } });
  fireEvent.change(screen.getByLabelText('Root collection URL'), {
    target: { value: collectionUrl },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open collection' }));
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

  it('opens an item URL, renders its collection, and opens item details', async () => {
    render(<App api={api()} tokenStore={tokenStore()} />);
    submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123/7-000000-aaaaaa/edit');

    expect(await screen.findByRole('heading', { name: 'Stories' })).toBeInTheDocument();
    const htmlCell = screen.getByRole('cell', { name: 'First story' });
    expect(htmlCell).toBeInTheDocument();
    expect(htmlCell.querySelector('strong')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'workflowStatus' })).not.toBeChecked();
    expect(screen.getByRole('dialog', { name: '7-000000-aaaaaa' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /open first story in zesty manager/i }),
    ).toHaveAttribute(
      'href',
      'https://8-abc123.manager.zesty.io/content/6-model123/7-000000-aaaaaa',
    );
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
    submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');

    expect(
      await screen.findByRole('heading', { name: 'Replace your session token' }),
    ).toBeInTheDocument();
    expect(clear).toHaveBeenCalledWith('production');
    expect(screen.getByLabelText('Root collection URL')).toHaveValue(
      'https://8-abc123.manager.zesty.io/content/6-model123',
    );

    submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123', 'replacement-token');
    await waitFor(() => expect(attempts).toBe(2));
    expect(await screen.findByRole('heading', { name: 'Stories' })).toBeInTheDocument();
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
    submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');

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
    expect(screen.getByLabelText('Published only')).toBeChecked();
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
    submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123');
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
    submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123', 'production-token');
    await screen.findByRole('heading', { name: 'Stories' });
    fireEvent.click(screen.getByRole('button', { name: 'Replace root' }));
    fireEvent.change(screen.getByLabelText('Root collection URL'), {
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
    submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123', 'first-token');
    await screen.findByRole('heading', { name: 'Stories' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear session token' }));
    submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123', 'second-token');
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
    submitStartForm('https://8-abc123.manager.zesty.io/content/6-model123', 'replacement-token');
    await waitFor(() => expect(childAttempts).toBe(2));
    expect(await screen.findByRole('heading', { name: 'Stories' })).toBeInTheDocument();
  });
});
