import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type {
  CollectionNode,
  CollectionSchema,
  CollectionSnapshot,
  ContentLanguage,
  ContentScope,
  ContentState,
  ExplorerError,
  LanguageCode,
} from '../../domain';
import { snapshotQueryKey, type CollectionApi } from '../../zesty-api';
import { ExplorerQueryError, explorerFailure, runExplorerQuery } from './explorer-query';
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
  readonly api: CollectionApi;
  readonly root: CollectionNode | undefined;
  readonly contentState: ContentState;
  /** The language the view names, or undefined for the instance's default language. */
  readonly language: LanguageCode | undefined;
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
  /** The scope the view is read in; undefined until its language is known. */
  readonly contentScope: ContentScope | undefined;
  /** The instance's active languages, default first; undefined while loading or after a failure. */
  readonly languages: readonly ContentLanguage[] | undefined;
  readonly loadedView: LoadedView | undefined;
  readonly rootSchema: CollectionSchema | undefined;
  readonly rootSnapshot: CollectionSnapshot | undefined;
  readonly status: LoadedViewQueryStatus;
  readonly authenticationFailed: boolean;
  readonly isIncomplete: boolean;
  readonly refresh: () => Promise<boolean>;
  readonly retryRoot: () => Promise<void>;
}

function collectionQueryKey(
  credentialRevision: string,
  node: CollectionNode,
  contentScope: ContentScope,
  itemLimit: number,
) {
  return [
    'collection',
    credentialRevision,
    snapshotQueryKey(node.reference, contentScope),
    itemLimit,
  ] as const;
}

// The language the view reads. A named language is trusted until the instance's languages are
// known, then only if it is still active. The Explorer read only en-US before languages could be
// chosen, so it still does for an instance that reports no active language.
function resolveLanguage(
  named: LanguageCode | undefined,
  languages: readonly ContentLanguage[] | undefined,
): LanguageCode | undefined {
  if (!languages) return named;
  if (named && languages.some((language) => language.code === named)) return named;
  return (languages.find((language) => language.isDefault) ?? languages[0])?.code ?? 'en-US';
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
  language,
  sessionToken,
  enabled,
  requiresCompleteView,
}: LoadedViewQueryOptions): LoadedViewQueryResult {
  const queryClient = useQueryClient();
  const credentials = useMemo(
    () => ({ revision: crypto.randomUUID(), sessionToken }),
    [sessionToken],
  );
  // Also feeds the language menu, so it loads even when the view names its language.
  const languagesQuery = useQuery<readonly ContentLanguage[], Error>({
    queryKey: [
      'languages',
      credentials.revision,
      root?.reference.deployment ?? '',
      root?.reference.instanceZuid ?? '',
    ],
    enabled: enabled && Boolean(root),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) => {
      if (!root || !credentials.sessionToken) throw new Error('Language request is not ready.');
      return runExplorerQuery(api.loadLanguages(root.reference, credentials.sessionToken), signal);
    },
  });
  const resolvedLanguage = resolveLanguage(language, languagesQuery.data);
  const contentScope = useMemo<ContentScope | undefined>(
    () => (resolvedLanguage ? { state: contentState, language: resolvedLanguage } : undefined),
    [contentState, resolvedLanguage],
  );
  // Without a named language the view can't load until the default one is known.
  const languagesFailure = language ? undefined : explorerFailure(languagesQuery.error);
  const rootQuery = useQuery<LoadedCollection, Error>({
    queryKey:
      root && contentScope
        ? collectionQueryKey(credentials.revision, root, contentScope, 10_000)
        : ['collection', 'closed'],
    enabled: enabled && Boolean(contentScope),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) => {
      if (!root || !contentScope || !credentials.sessionToken) {
        throw new Error('Collection request is not ready.');
      }
      try {
        return await loadCollection(
          api,
          root,
          contentScope,
          credentials.sessionToken,
          10_000,
          signal,
        );
      } catch (error) {
        if (error instanceof ViewLoadError) throw new ExplorerQueryError(error.failure);
        throw error;
      }
    },
  });

  const viewQuery = useQuery<LoadedView, Error>({
    queryKey:
      root && contentScope
        ? [
            'view',
            credentials.revision,
            rootQuery.dataUpdatedAt,
            contentScope,
            ...viewLoadKey(root, contentScope),
          ]
        : ['view', 'closed'],
    enabled: enabled && Boolean(rootQuery.data),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) => {
      if (!root || !contentScope || !credentials.sessionToken || !rootQuery.data) {
        throw new Error('Collection request is not ready.');
      }
      return loadView(root, contentScope, rootQuery.data, (node, itemLimit) =>
        queryClient.fetchQuery({
          queryKey: collectionQueryKey(credentials.revision, node, contentScope, itemLimit),
          staleTime: Number.POSITIVE_INFINITY,
          queryFn: ({ signal: collectionSignal }) =>
            loadCollection(
              api,
              node,
              contentScope,
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
    if (!root || !contentScope || !rootQuery.data) return undefined;
    return rootLoadedView(root, contentScope, rootQuery.data);
  }, [contentScope, root, rootQuery.data, viewQuery.data]);
  const rootFailure = languagesFailure ?? explorerFailure(rootQuery.error);

  const refresh = useCallback(async () => {
    await Promise.all(
      ['collection', 'languages'].map((name) =>
        queryClient.refetchQueries({ queryKey: [name, credentials.revision], type: 'all' }),
      ),
    );
    return queryClient
      .getQueryCache()
      .findAll({ queryKey: ['collection', credentials.revision] })
      .every((query) => query.state.status !== 'error');
  }, [credentials.revision, queryClient]);
  const retryRoot = useCallback(async () => {
    await (languagesFailure ? languagesQuery.refetch() : rootQuery.refetch());
  }, [languagesFailure, languagesQuery, rootQuery]);

  return {
    contentScope,
    languages: languagesQuery.data,
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
