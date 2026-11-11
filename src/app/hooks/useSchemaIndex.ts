import {
  queryOptions,
  useQueries,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type {
  CollectionCatalogEntry,
  CollectionNodeId,
  CollectionReference,
  CollectionSchema,
  ModelZuid,
} from '../../domain';
import { indexRelatedCollections, type RelatedCollections } from '../../explorer-core';

export type SchemaLoader = (
  reference: CollectionReference,
  signal: AbortSignal,
) => Promise<
  | { readonly ok: true; readonly schema: CollectionSchema }
  | { readonly ok: false; readonly message: string }
>;

export const relationshipSchemaQueryRoot = 'relationship-schema';

/**
 * One collection's schema. The add-relationship dialog and the catalog-wide index keep separate
 * entries, so the dialog never waits behind the index's queue; it starts from the index's copy
 * when there is one. A schema rarely changes, so a loaded one is kept until Refresh.
 */
export function relationshipSchemaQuery(
  reference: CollectionReference | undefined,
  loadSchema: SchemaLoader,
  consumer: 'dialog' | 'index',
) {
  return queryOptions({
    queryKey: [
      relationshipSchemaQueryRoot,
      consumer,
      reference?.instanceZuid ?? '',
      reference?.deployment ?? '',
      reference?.modelZuid ?? '',
    ] as const,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) => {
      if (!reference) throw new Error('A valid related collection URL is required.');
      const result = await loadSchema(reference, signal);
      if (!result.ok) throw new Error(result.message);
      return result.schema;
    },
  });
}

/**
 * The collections one instance's tree can attach, from its catalog, and their links. Each schema
 * comes from the freshest copy: one the index loaded since the last Refresh, else the view's own,
 * which covers each node before the index loads and an uncatalogued root, else an older index one.
 */
export function relatedCollectionsFor(
  instance: Pick<CollectionReference, 'instanceZuid' | 'deployment'>,
  catalog: readonly CollectionCatalogEntry[],
  index: Pick<SchemaIndexState, 'schemas' | 'staleSchemas'>,
  nodeSchemas: ReadonlyMap<CollectionNodeId, CollectionSchema>,
): {
  readonly collections: RelatedCollections;
  readonly catalogByModel: ReadonlyMap<ModelZuid, CollectionCatalogEntry>;
} {
  const schemas = new Map(index.staleSchemas);
  for (const schema of nodeSchemas.values()) schemas.set(schema.modelZuid, schema);
  for (const schema of index.schemas.values()) schemas.set(schema.modelZuid, schema);
  const catalogByModel = new Map(
    catalog
      .filter(
        (entry) =>
          entry.reference.instanceZuid === instance.instanceZuid &&
          entry.reference.deployment === instance.deployment,
      )
      .map((entry) => [entry.reference.modelZuid, entry]),
  );
  const labels = new Map([...catalogByModel].map(([modelZuid, entry]) => [modelZuid, entry.label]));
  return { collections: indexRelatedCollections(schemas.values(), labels), catalogByModel };
}

export interface SchemaIndexState {
  /** Schemas loaded since the last Refresh. */
  readonly schemas: ReadonlyMap<ModelZuid, CollectionSchema>;
  /** Schemas from before the last Refresh that have not reloaded yet, or failed to. */
  readonly staleSchemas: ReadonlyMap<ModelZuid, CollectionSchema>;
  readonly settled: number;
  readonly failed: number;
  readonly total: number;
  /** Every schema loaded or failed since the last Refresh. */
  readonly done: boolean;
}

interface IndexEntry {
  readonly schema: CollectionSchema | undefined;
  readonly loadedAt: number;
  readonly failedAt: number;
  readonly loading: boolean;
}

function indexEntries(results: readonly UseQueryResult<CollectionSchema>[]): readonly IndexEntry[] {
  return results.map((result) => ({
    schema: result.data,
    loadedAt: result.dataUpdatedAt,
    failedAt: result.errorUpdatedAt,
    loading: result.isFetching,
  }));
}

// Judged by load times, not by TanStack's stale flag, which a disabled query never sets.
function summarizeSchemas(entries: readonly IndexEntry[], refreshedAt: number): SchemaIndexState {
  const schemas = new Map<ModelZuid, CollectionSchema>();
  const staleSchemas = new Map<ModelZuid, CollectionSchema>();
  let settled = 0;
  let failed = 0;
  for (const { schema, loadedAt, failedAt, loading } of entries) {
    const current = schema !== undefined && loadedAt >= refreshedAt && loadedAt >= failedAt;
    const failedSinceRefresh = failedAt >= refreshedAt && failedAt > loadedAt;
    if (schema) (current ? schemas : staleSchemas).set(schema.modelZuid, schema);
    if (loading) continue;
    if (failedSinceRefresh) failed += 1;
    if (current || failedSinceRefresh) settled += 1;
  }
  return {
    schemas,
    staleSchemas,
    settled,
    failed,
    total: entries.length,
    done: settled === entries.length,
  };
}

/**
 * Loads the schema of every catalog collection. Zesty has no endpoint that lists the fields of
 * every model, and finding the collections that reference one needs all of them. It is never done
 * without a catalog: undefined means the catalog has not loaded. `refreshedAt` is when Refresh
 * last made every schema stale.
 */
export function useSchemaIndex({
  catalog,
  loadSchema,
  enabled,
  refreshedAt,
}: {
  readonly catalog: readonly CollectionCatalogEntry[] | undefined;
  readonly loadSchema: SchemaLoader;
  readonly enabled: boolean;
  readonly refreshedAt: number;
}): SchemaIndexState {
  const queryClient = useQueryClient();
  // When nothing uses the index any more, loads still waiting for a permit are not needed.
  useEffect(() => {
    if (enabled) return;
    // A cancelled reload keeps its previous schema, still marked stale.
    void queryClient.cancelQueries({ queryKey: [relationshipSchemaQueryRoot, 'index'] });
  }, [enabled, queryClient]);
  const entries = useQueries({
    queries: (catalog ?? []).map((entry) => ({
      ...relationshipSchemaQuery(entry.reference, loadSchema, 'index'),
      enabled,
    })),
    combine: indexEntries,
  });
  const index = useMemo(() => summarizeSchemas(entries, refreshedAt), [entries, refreshedAt]);
  return catalog ? index : { ...index, done: false };
}
