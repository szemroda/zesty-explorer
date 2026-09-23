import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Effect, Either } from 'effect';
import { useCallback, useEffect, useMemo } from 'react';
import type { CollectionCatalog, ExplorerError, InstanceReference } from '../../domain';
import type { CollectionApi } from '../../zesty-api';

interface CollectionCatalogQueryOptions {
  readonly api: CollectionApi;
  readonly reference: InstanceReference | undefined;
  readonly sessionToken: string;
  readonly enabled: boolean;
}

class CatalogQueryError extends Error {
  constructor(readonly failure: ExplorerError) {
    super(failure.message);
    this.name = 'CatalogQueryError';
  }
}

export interface CollectionCatalogQueryResult {
  readonly catalog: CollectionCatalog | undefined;
  readonly error: ExplorerError | undefined;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly refresh: () => Promise<boolean>;
}

export function useCollectionCatalog({
  api,
  reference,
  sessionToken,
  enabled,
}: CollectionCatalogQueryOptions): CollectionCatalogQueryResult {
  const queryClient = useQueryClient();
  const credentials = useMemo(
    () => ({ revision: crypto.randomUUID(), sessionToken }),
    [sessionToken],
  );
  const queryKey = [
    'catalog',
    credentials.revision,
    reference?.deployment ?? '',
    reference?.instanceZuid ?? '',
  ] as const;

  useEffect(() => {
    queryClient.removeQueries({
      queryKey: ['catalog'],
      predicate: (query) => query.queryKey[1] !== credentials.revision,
    });
  }, [credentials.revision, queryClient]);

  const query = useQuery<CollectionCatalog, Error>({
    queryKey,
    enabled,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) => {
      if (!reference || !credentials.sessionToken) throw new Error('Catalog request is not ready.');
      const result = await Effect.runPromise(
        api.loadCollectionCatalog(reference, credentials.sessionToken).pipe(Effect.either),
        { signal },
      );
      if (Either.isLeft(result)) throw new CatalogQueryError(result.left);
      return result.right;
    },
  });

  const refresh = useCallback(async () => {
    const result = await query.refetch();
    return !result.isError;
  }, [query]);

  return {
    catalog: query.data,
    error: query.error instanceof CatalogQueryError ? query.error.failure : undefined,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refresh,
  };
}
