import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  generateRelationshipGraph,
  type CollectionSchema,
  type CollectionSnapshot,
  type ExplorerError,
  type ModelZuid,
} from '../../domain';
import { collectionNode, queryClientWrapper } from '../../test/fixtures';
import type { CollectionApi } from '../../zesty-api';
import { useLoadedView } from './useLoadedView';

const generated = generateRelationshipGraph(2);

function collectionSnapshot(modelZuid: ModelZuid): CollectionSnapshot {
  const source = modelZuid === '6-child' ? generated.children : generated.parents;
  return { ...source, id: `snapshot-${modelZuid}`, modelZuid };
}

describe('loaded view query', () => {
  it('loads the root and descendants, then refreshes them and the languages', async () => {
    const child = collectionNode('node-child', '6-child');
    const root = collectionNode('node-root', '6-root', [child]);
    const loadCollectionSnapshot = vi.fn<CollectionApi['loadCollectionSnapshot']>((reference) =>
      Effect.succeed(collectionSnapshot(reference.modelZuid)),
    );
    const loadLanguages = vi.fn<CollectionApi['loadLanguages']>(() => Effect.succeed([]));
    const api: CollectionApi = {
      loadCollectionCatalog: () => Effect.succeed({ collections: [], incomplete: false }),
      loadLanguages,
      loadCollectionSchema: (reference) =>
        Effect.succeed({
          modelZuid: reference.modelZuid,
          label: reference.modelZuid,
          fields: [],
        } satisfies CollectionSchema),
      loadCollectionSnapshot,
    };
    const client = new QueryClient();
    const { result } = renderHook(
      () =>
        useLoadedView({
          api,
          root,
          contentState: 'latest',
          language: 'en-US',
          sessionToken: 'session-token',
          enabled: true,
          requiresCompleteView: false,
        }),
      { wrapper: queryClientWrapper(client) },
    );

    await waitFor(() => expect(result.current.loadedView?.schemas.size).toBe(2));
    expect(result.current.rootSnapshot?.modelZuid).toBe('6-root');
    expect(result.current.authenticationFailed).toBe(false);
    expect(result.current.status).toEqual({ kind: 'ready' });
    expect(loadCollectionSnapshot).toHaveBeenCalledTimes(2);

    await act(() => result.current.refresh());
    await waitFor(() => expect(loadCollectionSnapshot.mock.calls.length).toBeGreaterThan(2));
    expect(loadLanguages).toHaveBeenCalledTimes(2);
  });

  it('reports typed root authentication failures through its interface', async () => {
    const failure: ExplorerError = {
      kind: 'authentication',
      status: 401,
      message: 'Expired',
    };
    const api: CollectionApi = {
      loadCollectionCatalog: () => Effect.succeed({ collections: [], incomplete: false }),
      loadLanguages: () => Effect.succeed([]),
      loadCollectionSchema: () =>
        Effect.succeed({ modelZuid: '6-root', label: 'Root', fields: [] }),
      loadCollectionSnapshot: () => Effect.fail(failure),
    };
    const client = new QueryClient();
    const root = collectionNode('node-root', '6-root');
    const { result } = renderHook(
      () =>
        useLoadedView({
          api,
          root,
          contentState: 'latest',
          language: 'en-US',
          sessionToken: 'expired-token',
          enabled: true,
          requiresCompleteView: false,
        }),
      { wrapper: queryClientWrapper(client) },
    );

    await waitFor(() => expect(result.current.status).toEqual({ kind: 'failed', failure }));
    expect(result.current.authenticationFailed).toBe(true);
    expect(result.current.loadedView).toBeUndefined();
  });
  it('reads the instance default language unless the view names one', async () => {
    const loadCollectionSnapshot = vi.fn<CollectionApi['loadCollectionSnapshot']>((reference) =>
      Effect.succeed(collectionSnapshot(reference.modelZuid)),
    );
    const api: CollectionApi = {
      loadCollectionCatalog: () => Effect.succeed({ collections: [], incomplete: false }),
      loadLanguages: () =>
        Effect.succeed([
          { code: 'cs', name: 'Czech', isDefault: false },
          { code: 'de-DE', name: 'German', isDefault: true },
        ]),
      loadCollectionSchema: () =>
        Effect.succeed({ modelZuid: '6-root', label: 'Root', fields: [] }),
      loadCollectionSnapshot,
    };
    const { result } = renderHook(
      () =>
        useLoadedView({
          api,
          root: collectionNode('node-root', '6-root'),
          contentState: 'published',
          language: undefined,
          sessionToken: 'session-token',
          enabled: true,
          requiresCompleteView: false,
        }),
      { wrapper: queryClientWrapper(new QueryClient()) },
    );

    await waitFor(() => expect(result.current.status).toEqual({ kind: 'ready' }));
    expect(result.current.contentScope).toEqual({ state: 'published', language: 'de-DE' });
    expect(loadCollectionSnapshot.mock.calls.map(([, scope]) => scope)).toEqual([
      { state: 'published', language: 'de-DE' },
    ]);
  });

  it('reads the default language instead of a named one the instance no longer has', async () => {
    const api: CollectionApi = {
      loadCollectionCatalog: () => Effect.succeed({ collections: [], incomplete: false }),
      loadLanguages: () =>
        Effect.succeed([
          { code: 'en-US', name: 'English (US)', isDefault: true },
          { code: 'de-DE', name: 'German', isDefault: false },
        ]),
      loadCollectionSchema: () =>
        Effect.succeed({ modelZuid: '6-root', label: 'Root', fields: [] }),
      loadCollectionSnapshot: (reference) =>
        Effect.succeed(collectionSnapshot(reference.modelZuid)),
    };
    const { result } = renderHook(
      () =>
        useLoadedView({
          api,
          root: collectionNode('node-root', '6-root'),
          contentState: 'latest',
          language: 'fr-FR',
          sessionToken: 'session-token',
          enabled: true,
          requiresCompleteView: false,
        }),
      { wrapper: queryClientWrapper(new QueryClient()) },
    );

    await waitFor(() =>
      expect(result.current.contentScope).toEqual({ state: 'latest', language: 'en-US' }),
    );
  });

  it('fails the view with the language list failure while its default language is unknown', async () => {
    const failure: ExplorerError = { kind: 'network', message: 'Unreachable' };
    const loadCollectionSnapshot = vi.fn<CollectionApi['loadCollectionSnapshot']>();
    const api: CollectionApi = {
      loadCollectionCatalog: () => Effect.succeed({ collections: [], incomplete: false }),
      loadLanguages: () => Effect.fail(failure),
      loadCollectionSchema: () =>
        Effect.succeed({ modelZuid: '6-root', label: 'Root', fields: [] }),
      loadCollectionSnapshot,
    };
    const { result } = renderHook(
      () =>
        useLoadedView({
          api,
          root: collectionNode('node-root', '6-root'),
          contentState: 'latest',
          language: undefined,
          sessionToken: 'session-token',
          enabled: true,
          requiresCompleteView: false,
        }),
      { wrapper: queryClientWrapper(new QueryClient()) },
    );

    await waitFor(() => expect(result.current.status).toEqual({ kind: 'failed', failure }));
    expect(loadCollectionSnapshot).not.toHaveBeenCalled();
  });
});
