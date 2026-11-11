import { queryOptions, useQueries, type UseQueryResult } from '@tanstack/react-query';
import type {
  CollectionCatalogEntry,
  CollectionNode,
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
 * One collection's schema, shared by the add-relationship dialog and the schema index so each
 * loads once. A schema rarely changes, so a loaded one is kept until Refresh invalidates it.
 */
export function relationshipSchemaQuery(
  reference: CollectionReference | undefined,
  loadSchema: SchemaLoader,
) {
  return queryOptions({
    queryKey: [
      relationshipSchemaQueryRoot,
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
 * The collections a view's tree can attach, from the catalog of its instance, and their links:
 * from the catalog-wide index and the view's own node schemas. Those load with the view and
 * refresh with it, so they win; they also cover each node before the index loads.
 */
export function relatedCollectionsFor(
  root: CollectionNode,
  catalog: readonly CollectionCatalogEntry[],
  indexSchemas: ReadonlyMap<ModelZuid, CollectionSchema>,
  nodeSchemas: ReadonlyMap<CollectionNodeId, CollectionSchema>,
): {
  readonly collections: RelatedCollections;
  readonly catalogByModel: ReadonlyMap<ModelZuid, CollectionCatalogEntry>;
} {
  const schemas = new Map(indexSchemas);
  const visit = (node: CollectionNode) => {
    const schema = nodeSchemas.get(node.id);
    if (schema) schemas.set(node.reference.modelZuid, schema);
    node.children.forEach(visit);
  };
  visit(root);
  const catalogByModel = new Map(
    catalog
      .filter(
        (entry) =>
          entry.reference.instanceZuid === root.reference.instanceZuid &&
          entry.reference.deployment === root.reference.deployment,
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

function combineSchemas(results: readonly UseQueryResult<CollectionSchema>[]): SchemaIndexState {
  const schemas = new Map<ModelZuid, CollectionSchema>();
  let failed = 0;
  for (const result of results) {
    if (result.data) schemas.set(result.data.modelZuid, result.data);
    else if (result.isError) failed += 1;
  }
  const settled = schemas.size + failed;
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
      ...relationshipSchemaQuery(entry.reference, loadSchema),
      enabled,
    })),
    combine: combineSchemas,
  });
  return catalog ? index : { ...index, done: false };
}
