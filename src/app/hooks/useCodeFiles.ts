import { useQueries, useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type {
  CodeFileList,
  CodeFileVersionList,
  CodeFileZuid,
  CodeState,
  CollectionReference,
  CollectionSchema,
  ExplorerError,
  InstanceReference,
  InstanceUser,
  ModelZuid,
} from '../../domain';
import type { CodeFileApi, CollectionApi, ItemVersionApi } from '../../zesty-api';
import { buildCodeVersionOptions, type CodeVersionOption } from '../code-file-history';
import { explorerFailure, runExplorerQuery } from './explorer-query';
import { historyResource, type VersionPreviewResource } from './useItemVersionPreview';

/** The session token and the revision that keys every query made with it. */
export interface CodeCredentials {
  readonly revision: string;
  readonly sessionToken: string;
}

/** Reloads the code files the Code tab shows, and the hosts serving its endpoints. */
export async function refreshCodeFiles(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    ['code-files', 'code-sites'].map((key) =>
      queryClient.refetchQueries({ queryKey: [key], type: 'active' }),
    ),
  );
}

/**
 * Drops code sources, schemas, and hosts fetched with another token. Sources live only in this
 * in-memory cache, so a replaced token never reuses them.
 */
export function clearCodeCacheOutsideRevision(queryClient: QueryClient, revision: string): void {
  for (const key of ['code-files', 'code-schema', 'code-sites']) {
    queryClient.removeQueries({
      queryKey: [key],
      predicate: (query) => query.queryKey[1] !== revision,
    });
  }
}

interface CodeFilesQueryOptions {
  readonly api: CodeFileApi;
  readonly instance: InstanceReference;
  readonly state: CodeState;
  readonly credentials: CodeCredentials;
  readonly enabled: boolean;
}

export interface CodeFilesQueryResult {
  readonly list: CodeFileList | undefined;
  readonly error: ExplorerError | undefined;
  readonly isLoading: boolean;
  readonly refresh: () => Promise<void>;
}

/** Every `/web/views` file of the instance in one code state. */
export function useCodeFiles({
  api,
  instance,
  state,
  credentials,
  enabled,
}: CodeFilesQueryOptions): CodeFilesQueryResult {
  const query = useQuery<CodeFileList, Error>({
    queryKey: [
      'code-files',
      credentials.revision,
      instance.deployment,
      instance.instanceZuid,
      state,
    ],
    enabled: enabled && Boolean(credentials.sessionToken),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) =>
      runExplorerQuery(api.loadCodeFiles(instance, state, credentials.sessionToken), signal),
  });

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    list: query.data,
    error: explorerFailure(query.error),
    isLoading: query.isLoading,
    refresh,
  };
}

interface WebEngineBaseUrlsOptions {
  readonly api: CodeFileApi;
  readonly instance: InstanceReference;
  readonly state: CodeState;
  readonly credentials: CodeCredentials;
  readonly enabled: boolean;
}

export interface WebEngineBaseUrlsResult {
  /** The preferred origin first; empty when published code has no live domain. */
  readonly baseUrls: readonly string[] | undefined;
  readonly error: ExplorerError | undefined;
  readonly refresh: () => void;
}

/** Where WebEngine serves the instance's endpoints in a code state, cached until refreshed. */
export function useWebEngineBaseUrls({
  api,
  instance,
  state,
  credentials,
  enabled,
}: WebEngineBaseUrlsOptions): WebEngineBaseUrlsResult {
  const query = useQuery<readonly string[], Error>({
    queryKey: [
      'code-sites',
      credentials.revision,
      instance.deployment,
      instance.instanceZuid,
      state,
    ],
    enabled: enabled && Boolean(credentials.sessionToken),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) =>
      runExplorerQuery(
        api.loadWebEngineBaseUrls(instance, state, credentials.sessionToken),
        signal,
      ),
  });
  const { refetch } = query;
  return {
    baseUrls: query.data,
    error: explorerFailure(query.error),
    refresh: useCallback(() => void refetch(), [refetch]),
  };
}

interface CodeSchemasOptions {
  readonly api: Pick<CollectionApi, 'loadCollectionSchema'>;
  readonly instance: InstanceReference;
  readonly modelZuids: readonly ModelZuid[];
  readonly credentials: CodeCredentials;
}

export interface CodeSchemasResult {
  readonly schemas: ReadonlyMap<ModelZuid, CollectionSchema>;
  readonly isLoading: boolean;
}

/** Field schemas for the collections a file refers to. A failed schema only leaves fields unlabeled. */
export function useCodeSchemas({
  api,
  instance,
  modelZuids,
  credentials,
}: CodeSchemasOptions): CodeSchemasResult {
  return useQueries({
    queries: modelZuids.map((modelZuid) => ({
      queryKey: [
        'code-schema',
        credentials.revision,
        instance.deployment,
        instance.instanceZuid,
        modelZuid,
      ],
      enabled: Boolean(credentials.sessionToken),
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
      queryFn: ({ signal }: { readonly signal: AbortSignal }) => {
        const reference: CollectionReference = {
          instanceZuid: instance.instanceZuid,
          modelZuid,
          deployment: instance.deployment,
          area: 'other',
          apiBaseUrl: instance.apiBaseUrl,
          managerBaseUrl: instance.managerBaseUrl,
        };
        return runExplorerQuery(
          api.loadCollectionSchema(reference, credentials.sessionToken),
          signal,
        );
      },
    })),
    combine: combineSchemas,
  });
}

// Module-level so TanStack Query keeps the combined result stable between renders.
function combineSchemas(
  results: readonly UseQueryResult<CollectionSchema, Error>[],
): CodeSchemasResult {
  return {
    schemas: new Map(
      results.flatMap((result) =>
        result.data ? [[result.data.modelZuid, result.data] as const] : [],
      ),
    ),
    isLoading: results.some((result) => result.isLoading),
  };
}

interface CodeFileHistoryOptions {
  readonly api: CodeFileApi & Pick<ItemVersionApi, 'loadInstanceUsers'>;
  readonly instance: InstanceReference;
  readonly fileId: CodeFileZuid;
  readonly publishedVersion: number | undefined;
  readonly credentials: CodeCredentials;
}

export interface CodeFileHistoryResult {
  readonly options: readonly CodeVersionOption[];
  /** How many versions Zesty has, including older ones it did not return. */
  readonly total: number;
  readonly versions: VersionPreviewResource;
  readonly authors: VersionPreviewResource;
}

/**
 * Every saved version of one code file with its authors. Loaded afresh each time code history
 * opens, since the Code tab's file list stays cached until refreshed.
 */
export function useCodeFileHistory({
  api,
  instance,
  fileId,
  publishedVersion,
  credentials,
}: CodeFileHistoryOptions): CodeFileHistoryResult {
  const scope = ['code-files', credentials.revision, instance.deployment, instance.instanceZuid];
  const versionsQuery = useQuery<CodeFileVersionList, Error>({
    queryKey: [...scope, 'versions', fileId],
    enabled: Boolean(credentials.sessionToken),
    retry: false,
    refetchOnMount: 'always',
    queryFn: ({ signal }) =>
      runExplorerQuery(
        api.loadCodeFileVersions(instance, fileId, credentials.sessionToken),
        signal,
      ),
  });
  const authorsQuery = useQuery<readonly InstanceUser[], Error>({
    queryKey: [...scope, 'authors'],
    enabled: Boolean(credentials.sessionToken),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) =>
      runExplorerQuery(api.loadInstanceUsers(instance, credentials.sessionToken), signal),
  });

  // A failed reload leaves earlier versions cached; they are not shown as current.
  const list = versionsQuery.isError ? undefined : versionsQuery.data;
  const options = useMemo(
    () =>
      buildCodeVersionOptions({
        versions: list?.versions ?? [],
        publishedVersion,
        users: authorsQuery.data ?? [],
        usersState: authorsQuery.data ? 'ready' : authorsQuery.isLoading ? 'loading' : 'failed',
      }),
    [authorsQuery.data, authorsQuery.isLoading, list, publishedVersion],
  );
  return {
    options,
    total: list?.total ?? 0,
    versions: historyResource(versionsQuery),
    authors: historyResource(authorsQuery),
  };
}
