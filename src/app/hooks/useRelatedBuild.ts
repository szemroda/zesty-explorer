import { isCancelledError, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import type {
  CollectionCatalogEntry,
  CollectionNode,
  CollectionNodeId,
  CollectionReference,
  CollectionSchema,
} from '../../domain';
import { buildRelatedTree } from '../../explorer-core';
import { flattenCollectionNodes } from '../load-view';
import { createChildNode, sameCollection } from '../view-state';
import {
  relatedCollectionsFor,
  relationshipSchemaQuery,
  relationshipSchemaQueryRoot,
  useSchemaIndex,
  type SchemaIndexState,
  type SchemaLoader,
} from './useSchemaIndex';

interface RelatedBuildOptions {
  readonly treeRoot: CollectionNode | undefined;
  readonly setTreeRoot: Dispatch<SetStateAction<CollectionNode | undefined>>;
  /** The catalog of the tree root's instance, or undefined while it is not loaded. */
  readonly catalog: readonly CollectionCatalogEntry[] | undefined;
  readonly loadSchema: SchemaLoader;
  readonly offerUndo: (
    title: string,
    description: string,
    nextTreeRoot: CollectionNode,
    undo: () => void,
  ) => void;
}

export interface RelatedBuild {
  /** True while a new root waits for the schemas its related collections come from. */
  readonly pending: boolean;
  readonly schemaIndex: SchemaIndexState;
  /** Fills a root-only `root` from `catalog` once every schema loads; undefined stops a build. */
  readonly start: (
    root: CollectionNode | undefined,
    catalog: readonly CollectionCatalogEntry[],
  ) => void;
  readonly cancel: () => void;
  /** Loads every schema so tree nodes can list the collections that reference them. */
  readonly requestReferences: () => void;
}

/**
 * Builds a new root's tree from the relationships in its instance's catalog. Opening another root
 * or adding a collection by hand before the schemas load leaves the tree as it is.
 */
export function useRelatedBuild({
  treeRoot,
  setTreeRoot,
  catalog,
  loadSchema,
  offerUndo,
}: RelatedBuildOptions): RelatedBuild {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  // Each start or cancel supersedes the build before it.
  const latestBuild = useRef(0);
  const latestTreeRoot = useRef(treeRoot);
  useEffect(() => {
    latestTreeRoot.current = treeRoot;
  }, [treeRoot]);
  // The instance whose nodes list the collections that reference them.
  const [referencesFor, setReferencesFor] = useState<string>();
  const rootInstance =
    treeRoot && `${treeRoot.reference.instanceZuid}:${treeRoot.reference.deployment}`;
  const referencesRequested = rootInstance !== undefined && referencesFor === rootInstance;
  // Also observes the schemas a build fetches, which is its progress.
  const schemaIndex = useSchemaIndex({ catalog, loadSchema, enabled: referencesRequested });

  async function build(
    root: CollectionNode,
    entries: readonly CollectionCatalogEntry[],
    buildId: number,
  ) {
    const references = [
      root.reference,
      ...entries
        .map((entry) => entry.reference)
        .filter((reference) => !sameCollection(reference, root.reference)),
    ];
    // A closing add-relationship dialog may cancel a schema this build shares; fetch it again.
    const fetchSchema = (reference: CollectionReference): Promise<CollectionSchema> =>
      queryClient
        .fetchQuery(relationshipSchemaQuery(reference, loadSchema))
        .catch((error: unknown) =>
          isCancelledError(error) && buildId === latestBuild.current
            ? fetchSchema(reference)
            : Promise.reject(error instanceof Error ? error : new Error(String(error))),
        );
    const results = await Promise.allSettled(references.map(fetchSchema));
    if (buildId !== latestBuild.current) return;
    setPending(false);
    const current = latestTreeRoot.current;
    if (
      !current ||
      current.children.length > 0 ||
      !sameCollection(current.reference, root.reference)
    )
      return;

    const schemas = new Map(
      results.flatMap((result) =>
        result.status === 'fulfilled' ? [[result.value.modelZuid, result.value] as const] : [],
      ),
    );
    const failed = results.length - schemas.size;
    const { collections, catalogByModel } = relatedCollectionsFor(
      current,
      entries,
      schemas,
      noNodeSchemas,
    );
    const built = buildRelatedTree(current, collections, (link, name) => {
      const entry = catalogByModel.get(link.modelZuid);
      return entry ? createChildNode(entry.reference, name, link.relationship) : undefined;
    });
    const added = flattenCollectionNodes(built).length - 1;
    const unchecked = failed === 0 ? '' : ` ${collectionCount(failed)} could not be checked.`;
    if (added === 0) {
      toast('No related collections found', {
        description: `No native relationship links ${current.name} to another collection.${unchecked}`,
      });
      return;
    }
    setTreeRoot(built);
    offerUndo(
      `Added ${collectionCount(added, 'related ')}`,
      `Remove the ones you don't need, or add more with + beside a collection.${unchecked}`,
      built,
      () => setTreeRoot((tree) => tree && { ...tree, children: [] }),
    );
  }

  return {
    pending,
    schemaIndex,
    start: (root, entries) => {
      latestBuild.current += 1;
      const startsBuild = root !== undefined && root.children.length === 0;
      setPending(startsBuild);
      if (startsBuild) void build(root, entries, latestBuild.current);
    },
    cancel: () => {
      latestBuild.current += 1;
      setPending(false);
      // Schemas still loading are no longer needed, unless nodes list the references.
      if (referencesRequested) return;
      void queryClient.cancelQueries({
        queryKey: [relationshipSchemaQueryRoot],
        predicate: (query) => query.state.data === undefined,
      });
    },
    requestReferences: () => setReferencesFor(rootInstance),
  };
}

const noNodeSchemas: ReadonlyMap<CollectionNodeId, CollectionSchema> = new Map();

function collectionCount(count: number, kind = ''): string {
  return `${count} ${kind}${count === 1 ? 'collection' : 'collections'}`;
}
