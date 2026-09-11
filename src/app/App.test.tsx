import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Effect, Either } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeCollectionPage,
  fixtureCollectionPage,
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
    expect(screen.getByRole('cell', { name: 'First story' })).toBeInTheDocument();
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
        version: 1,
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
});
