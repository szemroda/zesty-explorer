import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type {
  ContentItem,
  ContentItemReference,
  ContentItemVersion,
  Deployment,
  ExplorerError,
  InstanceZuid,
  InstanceUser,
  ItemPublishing,
} from '../../domain';
import type { ItemVersionApi } from '../../zesty-api';
import { explorerFailure, runExplorerQuery } from './explorer-query';
import {
  buildVersionPreviewOptions,
  contentItemVersionNumber,
  type VersionPreviewOption,
} from '../item-version-preview';

const ITEM_VERSION_PREVIEW_QUERY_KEY = ['item-version-preview'] as const;
const ITEM_VERSION_PREVIEW_CACHE_MS = 5 * 60 * 1_000;

export interface ItemVersionPreviewCacheScope {
  readonly credentialRevision: string;
  readonly deployment: Deployment | undefined;
  readonly instanceZuid: InstanceZuid | undefined;
}

interface ItemVersionPreviewOptions {
  readonly api: ItemVersionApi;
  readonly reference: ContentItemReference;
  readonly currentItem: ContentItem;
  readonly sessionToken: string;
  readonly credentialRevision: string;
}

export interface VersionPreviewResource {
  readonly isLoading: boolean;
  readonly error: ExplorerError | undefined;
  readonly retry: () => Promise<void>;
}

export interface ItemVersionPreviewResult {
  readonly options: readonly VersionPreviewOption[];
  readonly selectedOption: VersionPreviewOption | undefined;
  readonly selectedItem: ContentItem;
  readonly selectVersion: (version: number) => void;
  readonly history: VersionPreviewResource;
  readonly publishings: VersionPreviewResource;
  readonly authors: VersionPreviewResource;
}

function resource(query: {
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetch: () => Promise<unknown>;
}): VersionPreviewResource {
  return {
    isLoading: query.isLoading,
    error: explorerFailure(query.error),
    retry: async () => {
      await query.refetch();
    },
  };
}

export function clearItemVersionPreviewCacheOutsideScope(
  queryClient: QueryClient,
  scope: ItemVersionPreviewCacheScope,
): void {
  queryClient.removeQueries({
    queryKey: ITEM_VERSION_PREVIEW_QUERY_KEY,
    predicate: (query) =>
      query.queryKey[2] !== scope.credentialRevision ||
      query.queryKey[3] !== scope.deployment ||
      query.queryKey[4] !== scope.instanceZuid,
  });
}

export async function refreshActiveItemVersionPreviews(queryClient: QueryClient): Promise<boolean> {
  await queryClient.refetchQueries({ queryKey: ITEM_VERSION_PREVIEW_QUERY_KEY, type: 'active' });
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: ITEM_VERSION_PREVIEW_QUERY_KEY, type: 'active' })
    .every((query) => query.state.status !== 'error');
}

export function useItemVersionPreview({
  api,
  reference,
  currentItem,
  sessionToken,
  credentialRevision,
}: ItemVersionPreviewOptions): ItemVersionPreviewResult {
  const credentials = useMemo(
    () => ({ revision: credentialRevision, sessionToken }),
    [credentialRevision, sessionToken],
  );
  const itemScope = [
    credentials.revision,
    reference.deployment,
    reference.instanceZuid,
    reference.modelZuid,
    reference.itemZuid,
  ] as const;
  const historyKey = [...ITEM_VERSION_PREVIEW_QUERY_KEY, 'history', ...itemScope] as const;
  const publishingsKey = [...ITEM_VERSION_PREVIEW_QUERY_KEY, 'publishings', ...itemScope] as const;
  const authorsKey = [
    ...ITEM_VERSION_PREVIEW_QUERY_KEY,
    'authors',
    credentials.revision,
    reference.deployment,
    reference.instanceZuid,
  ] as const;

  const historyQuery = useQuery<readonly ContentItemVersion[], Error>({
    queryKey: historyKey,
    retry: false,
    staleTime: 0,
    gcTime: ITEM_VERSION_PREVIEW_CACHE_MS,
    refetchOnMount: 'always',
    queryFn: ({ signal }) =>
      runExplorerQuery(api.loadItemVersions(reference, credentials.sessionToken), signal),
  });
  const publishingsQuery = useQuery<readonly ItemPublishing[], Error>({
    queryKey: publishingsKey,
    retry: false,
    staleTime: 0,
    gcTime: ITEM_VERSION_PREVIEW_CACHE_MS,
    refetchOnMount: 'always',
    queryFn: ({ signal }) =>
      runExplorerQuery(api.loadItemPublishings(reference, credentials.sessionToken), signal),
  });
  const authorsQuery = useQuery<readonly InstanceUser[], Error>({
    queryKey: authorsKey,
    retry: false,
    staleTime: 0,
    gcTime: ITEM_VERSION_PREVIEW_CACHE_MS,
    refetchOnMount: 'always',
    queryFn: ({ signal }) =>
      runExplorerQuery(api.loadInstanceUsers(reference, credentials.sessionToken), signal),
  });

  const currentVersion = contentItemVersionNumber(currentItem);
  const [selectedVersion, setSelectedVersion] = useState(currentVersion);

  const options = useMemo(() => {
    const built = buildVersionPreviewOptions({
      currentItem,
      versions: historyQuery.data ?? [],
      publishings: publishingsQuery.data ?? [],
      users: authorsQuery.data ?? [],
      usersState: authorsQuery.data ? 'ready' : authorsQuery.isLoading ? 'loading' : 'failed',
      now: new Date(),
    });
    return historyQuery.data ? built : built.map((option) => ({ ...option, latestSaved: false }));
  }, [
    authorsQuery.data,
    authorsQuery.isLoading,
    currentItem,
    historyQuery.data,
    publishingsQuery.data,
  ]);
  const selectedOption =
    options.find((option) => option.number === selectedVersion) ??
    options.find((option) => option.currentInView) ??
    options[0];

  return {
    options,
    selectedOption,
    selectedItem: selectedOption?.item ?? currentItem,
    selectVersion: setSelectedVersion,
    history: resource(historyQuery),
    publishings: resource(publishingsQuery),
    authors: resource(authorsQuery),
  };
}
