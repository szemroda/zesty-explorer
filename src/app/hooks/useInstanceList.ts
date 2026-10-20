import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import type { Deployment, ExplorerError, InstanceList } from '../../domain';
import type { InstanceApi } from '../../zesty-api';
import { explorerFailure, runExplorerQuery } from './explorer-query';

interface InstanceListQueryOptions {
  readonly api: InstanceApi;
  readonly deployment: Deployment;
  readonly sessionToken: string;
  readonly enabled: boolean;
}

export interface InstanceListQueryResult {
  readonly list: InstanceList | undefined;
  readonly error: ExplorerError | undefined;
  readonly isLoading: boolean;
  readonly refresh: () => Promise<boolean>;
}

export function useInstanceList({
  api,
  deployment,
  sessionToken,
  enabled,
}: InstanceListQueryOptions): InstanceListQueryResult {
  const queryClient = useQueryClient();
  const credentials = useMemo(
    () => ({ revision: crypto.randomUUID(), sessionToken }),
    [sessionToken],
  );
  const queryKey = ['instances', credentials.revision, deployment] as const;

  useEffect(() => {
    queryClient.removeQueries({
      queryKey: ['instances'],
      predicate: (query) => query.queryKey[1] !== credentials.revision,
    });
  }, [credentials.revision, queryClient]);

  const query = useQuery<InstanceList, Error>({
    queryKey,
    enabled: enabled && Boolean(credentials.sessionToken),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) =>
      runExplorerQuery(api.loadInstances(deployment, credentials.sessionToken), signal),
  });
  const refresh = useCallback(async () => !(await query.refetch()).isError, [query]);
  return {
    list: query.data,
    error: explorerFailure(query.error),
    isLoading: query.isLoading,
    refresh,
  };
}
