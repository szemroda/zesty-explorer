import { useQueries, useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import type {
  CodeFileList,
  CodeState,
  CollectionReference,
  CollectionSchema,
  ExplorerError,
  InstanceReference,
  ModelZuid,
} from '../../domain';
import type { CodeFileApi, CollectionApi } from '../../zesty-api';
import { explorerFailure, runExplorerQuery } from './explorer-query';

/** The session token and the revision that keys every query made with it. */
export interface CodeCredentials {
  readonly revision: string;
  readonly sessionToken: string;
}

/**
 * Drops code sources and schemas fetched with another token. Sources live only in this
 * in-memory cache, so a replaced token never reuses them.
 */
/** Reloads the code files the Code tab shows; sources are cached until refreshed. */
export async function refreshCodeFiles(queryClient: QueryClient): Promise<void> {
  await queryClient.refetchQueries({ queryKey: ['code-files'], type: 'active' });
}

export function clearCodeCacheOutsideRevision(queryClient: QueryClient, revision: string): void {
  for (const key of ['code-files', 'code-schema']) {
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
