import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type {
  CollectionNode,
  CollectionSchema,
  CollectionSnapshot,
  ContentState,
  ExplorerError,
} from '../../domain';
import { snapshotQueryKey, type ZestyApi } from '../../zesty-api';
import {
  loadCollection,
  loadView,
  rootLoadedView,
  viewLoadKey,
  ViewLoadError,
  type LoadedCollection,
  type LoadedView,
} from '../load-view';

interface LoadedViewQueryOptions {
  readonly api: ZestyApi;
  readonly root: CollectionNode | undefined;
  readonly contentState: ContentState;
  readonly sessionToken: string;
  readonly enabled: boolean;
  readonly requiresCompleteView: boolean;
}

export type LoadedViewQueryStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading-root' }
  | { readonly kind: 'loading-related-data' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly failure: ExplorerError };

export interface LoadedViewQueryResult {
  readonly loadedView: LoadedView | undefined;
  readonly rootSchema: CollectionSchema | undefined;
  readonly rootSnapshot: CollectionSnapshot | undefined;
  readonly status: LoadedViewQueryStatus;
  readonly authenticationFailed: boolean;
  readonly isIncomplete: boolean;
  readonly refresh: () => Promise<boolean>;
  readonly retryRoot: () => Promise<void>;
}

class CollectionQueryError extends Error {
  constructor(readonly failure: ExplorerError) {
    super(failure.message);
    this.name = 'CollectionQueryError';
  }
}

function collectionQueryKey(
  credentialRevision: string,
  node: CollectionNode,
  contentState: ContentState,
  itemLimit: number,
) {
  return [
    'collection',
    credentialRevision,
    snapshotQueryKey(node.reference, contentState),
    itemLimit,
  ] as const;
}

function hasAuthenticationFailure(
  rootFailure: ExplorerError | undefined,
  loadedView: LoadedView | undefined,
): boolean {
  if (rootFailure?.kind === 'authentication') return true;
  return [...(loadedView?.snapshots.snapshots.values() ?? [])].some(
    (state) => state.status === 'failed' && state.error.kind === 'authentication',
  );
}

function hasIncompleteCollection(loadedView: LoadedView | undefined): boolean {
  return [...(loadedView?.snapshots.snapshots.values() ?? [])].some(
    (state) =>
      state.status === 'partial' ||
      (state.status === 'failed' && state.error.kind === 'data-limit'),
  );
}

function queryStatus(
  enabled: boolean,
  hasRoot: boolean,
  rootFailure: ExplorerError | undefined,
  descendantsAreFetching: boolean,
  requiresCompleteView: boolean,
): LoadedViewQueryStatus {
  if (!enabled) return { kind: 'idle' };
  if (rootFailure) return { kind: 'failed', failure: rootFailure };
  if (!hasRoot) return { kind: 'loading-root' };
  if (requiresCompleteView && descendantsAreFetching) {
    return { kind: 'loading-related-data' };
  }
  return { kind: 'ready' };
}

export function useLoadedView({
  api,
  root,
  contentState,
  sessionToken,
  enabled,
  requiresCompleteView,
}: LoadedViewQueryOptions): LoadedViewQueryResult {
  const queryClient = useQueryClient();
  const credentials = useMemo(
    () => ({ revision: crypto.randomUUID(), sessionToken }),
    [sessionToken],
  );
  const rootQuery = useQuery<LoadedCollection, Error>({
    queryKey: root
      ? collectionQueryKey(credentials.revision, root, contentState, 10_000)
      : ['collection', 'closed'],
    enabled,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) => {
      if (!root || !credentials.sessionToken) throw new Error('Collection request is not ready.');
      try {
        return await loadCollection(
          api,
          root,
          contentState,
          credentials.sessionToken,
          10_000,
          signal,
        );
      } catch (error) {
        if (error instanceof ViewLoadError) throw new CollectionQueryError(error.failure);
        throw error;
      }
    },
  });

  const viewQuery = useQuery<LoadedView, Error>({
    queryKey: root
      ? [
          'view',
          credentials.revision,
          rootQuery.dataUpdatedAt,
          contentState,
          ...viewLoadKey(root, contentState),
        ]
      : ['view', 'closed'],
    enabled: enabled && Boolean(rootQuery.data),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) => {
      if (!root || !credentials.sessionToken || !rootQuery.data) {
        throw new Error('Collection request is not ready.');
      }
      return loadView(root, contentState, rootQuery.data, (node, itemLimit) =>
        queryClient.fetchQuery({
          queryKey: collectionQueryKey(credentials.revision, node, contentState, itemLimit),
          staleTime: Number.POSITIVE_INFINITY,
          queryFn: ({ signal: collectionSignal }) =>
            loadCollection(
              api,
              node,
              contentState,
              credentials.sessionToken,
              itemLimit,
              AbortSignal.any([signal, collectionSignal]),
            ),
        }),
      );
    },
  });

  const loadedView = useMemo(() => {
    if (viewQuery.data) return viewQuery.data;
    if (!root || !rootQuery.data) return undefined;
    return rootLoadedView(root, contentState, rootQuery.data);
  }, [contentState, root, rootQuery.data, viewQuery.data]);
  const rootFailure =
    rootQuery.error instanceof CollectionQueryError ? rootQuery.error.failure : undefined;

  const refresh = useCallback(async () => {
    await queryClient.refetchQueries({
      queryKey: ['collection', credentials.revision],
      type: 'all',
    });
    return queryClient
      .getQueryCache()
      .findAll({ queryKey: ['collection', credentials.revision] })
      .every((query) => query.state.status !== 'error');
  }, [credentials.revision, queryClient]);
  const retryRoot = useCallback(async () => {
    await rootQuery.refetch();
  }, [rootQuery]);

  return {
    loadedView,
    rootSchema: rootQuery.data?.schema,
    rootSnapshot: rootQuery.data?.snapshot,
    status: queryStatus(
      enabled,
      Boolean(rootQuery.data),
      rootFailure,
      viewQuery.isFetching,
      requiresCompleteView,
    ),
    authenticationFailed: hasAuthenticationFailure(rootFailure, loadedView),
    isIncomplete: hasIncompleteCollection(loadedView),
    refresh,
    retryRoot,
  };
}
