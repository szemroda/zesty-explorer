import { queryOptions, useQueries, type UseQueryResult } from '@tanstack/react-query';
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
 * The collections one instance's tree can attach, from its catalog, and their links: from the
 * catalog-wide index and the view's own node schemas. Those load and refresh with the view, so
 * they win; they also cover each node before the index loads.
 */
export function relatedCollectionsFor(
  instance: Pick<CollectionReference, 'instanceZuid' | 'deployment'>,
  catalog: readonly CollectionCatalogEntry[],
  indexSchemas: ReadonlyMap<ModelZuid, CollectionSchema>,
  nodeSchemas: ReadonlyMap<CollectionNodeId, CollectionSchema>,
): {
  readonly collections: RelatedCollections;
  readonly catalogByModel: ReadonlyMap<ModelZuid, CollectionCatalogEntry>;
} {
  const schemas = new Map(indexSchemas);
  for (const schema of nodeSchemas.values()) schemas.set(schema.modelZuid, schema);
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
  readonly schemas: ReadonlyMap<ModelZuid, CollectionSchema>;
  readonly settled: number;
  readonly failed: number;
  readonly total: number;
  readonly done: boolean;
}

// A schema kept from before a Refresh still lists links, but the index is done only once every
// schema is current or has failed.
function combineSchemas(results: readonly UseQueryResult<CollectionSchema>[]): SchemaIndexState {
  const schemas = new Map<ModelZuid, CollectionSchema>();
  let settled = 0;
  let failed = 0;
  for (const result of results) {
    if (result.data) schemas.set(result.data.modelZuid, result.data);
    if (result.isFetching) continue;
    if (result.isError) failed += 1;
    if (result.isError || (result.data && !result.isStale)) settled += 1;
  }
  return { schemas, settled, failed, total: results.length, done: settled === results.length };
}

/**
 * Loads the schema of every catalog collection. Zesty has no endpoint that lists the fields of
 * every model, and finding the collections that reference one needs all of them. It is never done
 * without a catalog: undefined means the catalog has not loaded.
 */
export function useSchemaIndex({
  catalog,
  loadSchema,
  enabled,
}: {
  readonly catalog: readonly CollectionCatalogEntry[] | undefined;
  readonly loadSchema: SchemaLoader;
  readonly enabled: boolean;
}): SchemaIndexState {
  const index = useQueries({
    queries: (catalog ?? []).map((entry) => ({
      ...relationshipSchemaQuery(entry.reference, loadSchema, 'index'),
      enabled,
    })),
    combine: combineSchemas,
  });
  return catalog ? index : { ...index, done: false };
}
