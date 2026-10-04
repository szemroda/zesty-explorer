// Loads what an import check needs: the schema, the existing items and the related collections.
// Every request is a read; nothing is written to Zesty.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import type { CollectionCatalogEntry, CollectionReference } from '../../domain';
import { checkImport, type ImportCheck, type ParsedCsv } from '../../import-check';
import type { CollectionApi } from '../../zesty-api';
import { explorerFailure, runExplorerQuery } from './explorer-query';

export interface CsvSource {
  readonly fileName: string;
  readonly parsed: ParsedCsv;
}

export type ImportCheckState =
  | { readonly status: 'waiting' }
  | { readonly status: 'loading'; readonly step: string }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly check: ImportCheck };

export interface ImportCheckQuery {
  readonly state: ImportCheckState;
  /** The session token was rejected; the app should ask for a new one. */
  readonly authenticationFailed: boolean;
  /** Reads the Zesty data again, e.g. after an import changed the collection. */
  readonly reload: () => void;
}

const queryRoot = 'import-check';

export function useImportCheck({
  api,
  credentials,
  collection,
  source,
}: {
  readonly api: CollectionApi;
  readonly credentials: { readonly revision: string; readonly sessionToken: string };
  readonly collection: CollectionCatalogEntry | undefined;
  readonly source: CsvSource | undefined;
}): ImportCheckQuery {
  const queryClient = useQueryClient();
  const reference = collection?.reference;
  const enabled = Boolean(reference && source && credentials.sessionToken);
  const scope = [
    queryRoot,
    credentials.revision,
    reference?.deployment,
    reference?.instanceZuid,
  ] as const;

  useEffect(() => {
    queryClient.removeQueries({
      queryKey: [queryRoot],
      predicate: (query) => query.queryKey[1] !== credentials.revision,
    });
  }, [credentials.revision, queryClient]);

  const schema = useQuery({
    queryKey: [...scope, 'schema', reference?.modelZuid],
    enabled,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) =>
      runExplorerQuery(api.loadCollectionSchema(reference!, credentials.sessionToken), signal),
  });
  const existing = useQuery({
    queryKey: [...scope, 'items', reference?.modelZuid],
    enabled,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) =>
      runExplorerQuery(
        api.loadCollectionSnapshot(reference!, 'latest', credentials.sessionToken),
        signal,
      ),
  });
  const relatedModels = useMemo(
    () => [
      ...new Set(
        (schema.data?.fields ?? []).flatMap((field) =>
          field.relatedModelZuid ? [field.relatedModelZuid] : [],
        ),
      ),
    ],
    [schema.data],
  );
  // A related collection that can't be read completely is left out, so its ZUIDs go unchecked
  // instead of failing the whole check; `complete` tells the check so.
  const related = useQuery({
    queryKey: [...scope, 'related', relatedModels],
    enabled: enabled && schema.isSuccess,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) => {
      const snapshots = await Promise.allSettled(
        relatedModels.map(async (modelZuid) => {
          const relatedReference: CollectionReference = { ...reference!, modelZuid, area: 'other' };
          const snapshot = await runExplorerQuery(
            api.loadCollectionSnapshot(relatedReference, 'latest', credentials.sessionToken),
            signal,
          );
          return { modelZuid, snapshot };
        }),
      );
      const items = new Map<string, ReadonlySet<string>>(
        snapshots.flatMap((result) =>
          result.status === 'fulfilled' && !result.value.snapshot.partial
            ? [
                [
                  result.value.modelZuid,
                  new Set(result.value.snapshot.items.map((item) => item.id)),
                ] as const,
              ]
            : [],
        ),
      );
      return { items, complete: items.size === relatedModels.length };
    },
  });

  const reload = useCallback(
    () => void queryClient.resetQueries({ queryKey: [queryRoot] }),
    [queryClient],
  );

  const state = useMemo((): ImportCheckState => {
    if (!collection || !source) return { status: 'waiting' };
    if (schema.data && existing.data && related.data) {
      return {
        status: 'ready',
        check: checkImport({
          fileName: source.fileName,
          parsed: source.parsed,
          schema: schema.data,
          modelType: collection.type,
          existingItems: existing.data.items,
          relatedItems: related.data.items,
          zestyDataComplete: !existing.data.partial && related.data.complete,
        }),
      };
    }
    const failure = schema.error ?? existing.error ?? related.error;
    if (failure) {
      return {
        status: 'failed',
        message: explorerFailure(failure)?.message ?? 'Zesty data could not be loaded.',
      };
    }
    if (!schema.data) return { status: 'loading', step: 'Reading the content model' };
    if (!existing.data) return { status: 'loading', step: 'Reading existing items' };
    return { status: 'loading', step: 'Reading related collections' };
  }, [
    collection,
    existing.data,
    existing.error,
    related.data,
    related.error,
    schema.data,
    schema.error,
    source,
  ]);

  const authenticationFailed = [schema.error, existing.error].some(
    (error) => explorerFailure(error)?.kind === 'authentication',
  );
  return { state, reload, authenticationFailed };
}
