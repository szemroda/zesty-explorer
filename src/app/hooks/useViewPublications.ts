import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';
import type {
  CollectionNode,
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
  | { readonly kind: 'failed'; readonly message: string }
  | {
      readonly kind: 'ready';
      /** The version live now, or undefined when the item has none. */
      readonly publishedVersion: (itemId: ItemZuid) => number | undefined;
    };

type Publications = ReadonlyMap<ItemZuid, readonly ItemPublishing[]>;

const notNeeded: ViewPublications = { kind: 'not-needed' };
const publishedContent: ViewPublications = { kind: 'published-content' };
const loading: ViewPublications = { kind: 'loading' };

/** Whether a view filter or any table filter of the view tests publication state. */
export function filtersByPublication(
  root: CollectionNode | undefined,
  viewFilters: readonly ViewFilter[],
): boolean {
  if (viewFilters.some(isPublicationFilter)) return true;
  if (!root) return false;
  return flattenCollectionNodes(root).some((node) =>
    node.presentation.filters.some(isPublicationFilter),
  );
}

function combinePublications(results: readonly UseQueryResult<Publications, Error>[]) {
  const error = results.find((result) => result.error)?.error;
  if (error) {
    return { kind: 'failed', message: (explorerFailure(error) ?? error).message } as const;
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
  return { kind: 'ready', publishedVersion } as const;
}

/**
 * Loads the publication state of every collection in the view when a filter needs it. Each model
 * is read once, however many nodes show it.
 */
export function useViewPublications({
  source,
  root,
  contentState,
  needed,
}: {
  readonly source: ModelPublicationsSource;
  readonly root: CollectionNode | undefined;
  readonly contentState: ContentState;
  readonly needed: boolean;
}): ViewPublications {
  const loads = needed && contentState === 'latest' && root !== undefined;
  const references = useMemo(() => {
    if (!loads) return [];
    const byModel = new Map(
      flattenCollectionNodes(root).map((node) => [node.reference.modelZuid, node.reference]),
    );
    return [...byModel.values()];
  }, [loads, root]);
  const queries = useQueries({
    queries: references.map((reference) => modelPublicationsQuery(source, reference)),
    // A module-level function keeps its identity, so TanStack can reuse the combined result.
    combine: combinePublications,
  });
  if (!needed) return notNeeded;
  if (contentState === 'published') return publishedContent;
  return references.length === 0 ? loading : queries;
}
