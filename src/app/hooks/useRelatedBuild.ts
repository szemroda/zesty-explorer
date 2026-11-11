import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import type {
  CollectionCatalogEntry,
  CollectionNode,
  CollectionNodeId,
  CollectionSchema,
} from '../../domain';
import { buildRelatedTree } from '../../explorer-core';
import { flattenCollectionNodes } from '../load-view';
import { createChildNode, sameCollection, type CollectionIdentity } from '../view-state';
import {
  relatedCollectionsFor,
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
  /** True when the catalog failed and none is cached. */
  readonly catalogFailed: boolean;
  /** True when the root collection failed to load, so its schema may never arrive. */
  readonly rootFailed: boolean;
  readonly nodeSchemas: ReadonlyMap<CollectionNodeId, CollectionSchema>;
  readonly loadSchema: SchemaLoader;
  readonly offerUndo: (
    title: string,
    description: string,
    nextTreeRoot: CollectionNode,
    undo: () => void,
  ) => void;
}

export interface RelatedBuild {
  /** True while a new root-only tree waits for the schemas its related collections come from. */
  readonly pending: boolean;
  readonly schemaIndex: SchemaIndexState;
  /** Fills a root-only `root` once its instance's schemas load; undefined stops a build. */
  readonly start: (root: CollectionNode | undefined) => void;
  readonly cancel: () => void;
  /** Loads every schema so tree nodes can list the collections that reference them. */
  readonly requestReferences: () => void;
}

type BuildOutcome =
  | { readonly kind: 'added'; readonly tree: CollectionNode; readonly unchecked: number }
  | { readonly kind: 'none'; readonly rootName: string; readonly unchecked: number }
  | { readonly kind: 'no-catalog' };

/**
 * Builds a new root's tree from the relationships in its instance's catalog. It waits for that
 * catalog and every schema in it. Opening another root or adding a collection by hand meanwhile
 * ends the wait and leaves the tree as it is.
 */
export function useRelatedBuild({
  treeRoot,
  setTreeRoot,
  catalog,
  catalogFailed,
  rootFailed,
  nodeSchemas,
  loadSchema,
  offerUndo,
}: RelatedBuildOptions): RelatedBuild {
  const queryClient = useQueryClient();
  const [pendingRoot, setPendingRoot] = useState<CollectionIdentity>();
  const [outcome, setOutcome] = useState<BuildOutcome>();
  // The instance whose nodes list the collections that reference them.
  const [referencesFor, setReferencesFor] = useState<string>();
  const rootInstance =
    treeRoot && `${treeRoot.reference.instanceZuid}:${treeRoot.reference.deployment}`;
  const referencesRequested = rootInstance !== undefined && referencesFor === rootInstance;
  const schemaIndex = useSchemaIndex({
    catalog,
    loadSchema,
    enabled: pendingRoot !== undefined || referencesRequested,
  });

  // The build settles while rendering, as soon as what it waits for is known.
  const waitingRoot =
    pendingRoot &&
    treeRoot &&
    treeRoot.children.length === 0 &&
    sameCollection(treeRoot.reference, pendingRoot)
      ? treeRoot
      : undefined;
  if (pendingRoot && !waitingRoot) {
    setPendingRoot(undefined);
  } else if (waitingRoot && catalogFailed) {
    setPendingRoot(undefined);
    setOutcome({ kind: 'no-catalog' });
  } else if (
    waitingRoot &&
    catalog &&
    schemaIndex.done &&
    // The root's own links need its schema: from the index when it is catalogued, which is done,
    // or from the view, unless the view failed to load it.
    (nodeSchemas.has(waitingRoot.id) ||
      rootFailed ||
      catalog.some((entry) => sameCollection(entry.reference, waitingRoot.reference)))
  ) {
    setPendingRoot(undefined);
    const { collections, catalogByModel } = relatedCollectionsFor(
      waitingRoot.reference,
      catalog,
      schemaIndex.schemas,
      nodeSchemas,
    );
    const tree = buildRelatedTree(waitingRoot, collections, (link, name) => {
      const entry = catalogByModel.get(link.modelZuid);
      return entry ? createChildNode(entry.reference, name, link.relationship) : undefined;
    });
    if (tree.children.length > 0) {
      setTreeRoot(tree);
      setOutcome({ kind: 'added', tree, unchecked: schemaIndex.failed });
    } else {
      setOutcome({ kind: 'none', rootName: waitingRoot.name, unchecked: schemaIndex.failed });
    }
  }

  const announce = useEffectEvent((settled: BuildOutcome) => {
    if (settled.kind === 'no-catalog') {
      toast('Related collections were not added', {
        description: 'The collection catalog did not load. Retry it, then add them with +.',
      });
      return;
    }
    const unchecked =
      settled.unchecked === 0 ? '' : ` ${collectionCount(settled.unchecked)} could not be checked.`;
    if (settled.kind === 'none') {
      toast('No related collections found', {
        description: `No native relationship links ${settled.rootName} to another collection.${unchecked}`,
      });
      return;
    }
    offerUndo(
      `Added ${collectionCount(flattenCollectionNodes(settled.tree).length - 1, 'related ')}`,
      `Remove the ones you don't need, or add more with + beside a collection.${unchecked}`,
      settled.tree,
      () => setTreeRoot((tree) => tree && { ...tree, children: [] }),
    );
  });
  useEffect(() => {
    if (outcome) announce(outcome);
  }, [outcome]);

  return {
    pending: waitingRoot !== undefined,
    schemaIndex,
    start: (root) =>
      setPendingRoot(root && root.children.length === 0 ? { ...root.reference } : undefined),
    cancel: () => {
      setPendingRoot(undefined);
      // Schemas still loading are no longer needed, unless nodes list the references.
      if (referencesRequested) return;
      void queryClient.cancelQueries({
        queryKey: [relationshipSchemaQueryRoot, 'index'],
        predicate: (query) => query.state.data === undefined,
      });
    },
    requestReferences: () => setReferencesFor(rootInstance),
  };
}

function collectionCount(count: number, kind = ''): string {
  return `${count} ${kind}${count === 1 ? 'collection' : 'collections'}`;
}
