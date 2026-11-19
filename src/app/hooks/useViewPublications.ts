import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';
import type {
  CollectionNode,
  CollectionReference,
  ContentState,
  ItemPublishing,
  ItemZuid,
  ViewFilter,
} from '../../domain';
import { isPublicationFilter } from '../../explorer-core';
import { flattenCollectionNodes } from '../load-view';
import { explorerFailure } from './explorer-query';
import { modelPublicationsQuery, type ModelPublicationsSource } from './model-publications-query';

/** What publication state filters can read in the current view. */
export type ViewPublications =
  | { readonly kind: 'not-needed' }
  /** Published content has no newer saved version to compare with, so it has no state. */
  | { readonly kind: 'published-content' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string; readonly tokenRejected: boolean }
  | {
      readonly kind: 'ready';
      /** The version live now, or undefined when the item has none. */
      readonly publishedVersion: (itemId: ItemZuid) => number | undefined;
    };

type Publications = ReadonlyMap<ItemZuid, readonly ItemPublishing[]>;

const notNeeded: ViewPublications = { kind: 'not-needed' };
const publishedContent: ViewPublications = { kind: 'published-content' };
const loading: ViewPublications = { kind: 'loading' };

/**
 * The collections whose items publication filters test, one per model. A view filter tests the
 * root's items, a table filter its own node's items, and "or below" every collection under them.
 */
function testedCollections(
  root: CollectionNode,
  viewFilters: readonly ViewFilter[],
): readonly CollectionReference[] {
  const byModel = new Map<string, CollectionReference>();
  const add = (owner: CollectionNode, filter: ViewFilter) => {
    if (!isPublicationFilter(filter)) return;
    let target: CollectionNode | undefined = owner;
    for (const id of filter.nodePath) target = target?.children.find((child) => child.id === id);
    if (!target) return;
    const tested =
      filter.operator === 'one-of-or-below' ? flattenCollectionNodes(target) : [target];
    for (const node of tested) byModel.set(node.reference.modelZuid, node.reference);
  };
  viewFilters.forEach((filter) => add(root, filter));
  for (const node of flattenCollectionNodes(root)) {
    node.presentation.filters.forEach((filter) => add(node, filter));
  }
  return [...byModel.values()];
}

function combinePublications(
  results: readonly UseQueryResult<Publications, Error>[],
): ViewPublications {
  const error = results.find((result) => result.error)?.error;
  if (error) {
    const failure = explorerFailure(error);
    return {
      kind: 'failed',
      message: (failure ?? error).message,
      tokenRejected: failure?.kind === 'authentication',
    };
  }
  const maps = results.flatMap((result) => (result.data ? [result.data] : []));
  if (maps.length < results.length) return loading;
  // Item ZUIDs are unique across models, so the first map that knows the item has its records.
  const publishedVersion = (itemId: ItemZuid) => {
    for (const publications of maps) {
      const records = publications.get(itemId);
      if (records) return records.find((record) => record.active)?.version;
    }
    return undefined;
  };
  return { kind: 'ready', publishedVersion };
}

/**
 * Loads the publication state of the collections that publication filters test, each model once
 * however many nodes show it. Nothing loads while no filter tests publication state.
 */
export function useViewPublications({
  source,
  root,
  viewFilters,
  contentState,
  enabled,
}: {
  readonly source: ModelPublicationsSource;
  readonly root: CollectionNode | undefined;
  readonly viewFilters: readonly ViewFilter[];
  readonly contentState: ContentState;
  readonly enabled: boolean;
}): ViewPublications {
  const references = useMemo(
    () => (enabled && root ? testedCollections(root, viewFilters) : []),
    [enabled, root, viewFilters],
  );
  const loads = contentState === 'latest' && references.length > 0;
  const queries = useQueries({
    queries: loads ? references.map((reference) => modelPublicationsQuery(source, reference)) : [],
    // A module-level function keeps its identity, so TanStack can reuse the combined result.
    combine: combinePublications,
  });
  if (references.length === 0) return notNeeded;
  return loads ? queries : publishedContent;
}
