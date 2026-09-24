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
  it('loads the root and descendants, then refreshes the credential-scoped cache', async () => {
    const child = collectionNode('node-child', '6-child');
    const root = collectionNode('node-root', '6-root', [child]);
    const loadCollectionSnapshot = vi.fn<CollectionApi['loadCollectionSnapshot']>((reference) =>
      Effect.succeed(collectionSnapshot(reference.modelZuid)),
    );
    const api: CollectionApi = {
      loadCollectionCatalog: () => Effect.succeed({ collections: [], incomplete: false }),
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
  });

  it('reports typed root authentication failures through its interface', async () => {
    const failure: ExplorerError = {
      kind: 'authentication',
      status: 401,
      message: 'Expired',
    };
    const api: CollectionApi = {
      loadCollectionCatalog: () => Effect.succeed({ collections: [], incomplete: false }),
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
});
