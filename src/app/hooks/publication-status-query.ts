import type { Query, QueryClient } from '@tanstack/react-query';
import { Effect } from 'effect';
import type {
  ContentItem,
  ContentItemReference,
  ContentState,
  Deployment,
  InstanceZuid,
} from '../../domain';
import { withRequestPriority, type BackgroundStanding, type ItemVersionApi } from '../../zesty-api';
import { runExplorerQuery } from './explorer-query';
import { contentItemVersionNumber } from '../item-version-preview';
import { publicationStatus, type PublicationStatus } from '../publication-status';

export const publicationStatusQueryPrefix = ['publication-status'] as const;

export interface PublicationStatusSource {
  readonly api: ItemVersionApi;
  readonly sessionToken: string;
  readonly credentialRevision: string;
  /** The view's content state. Latest saved items already carry the latest saved version. */
  readonly contentState: ContentState;
}

/**
 * Loads one item's publication status as background work, queued by `standing`. It takes no abort
 * signal: a request that was sent runs to the end, and work no one needs is dropped while queued.
 */
export async function loadPublicationStatus(
  source: PublicationStatusSource,
  reference: ContentItemReference,
  item: ContentItem,
  standing: () => BackgroundStanding,
): Promise<PublicationStatus> {
  // The version history only finds a newer save than the item's own version when the view reads
  // published items; for latest saved items, publishings alone complete the status.
  const versions =
    source.contentState === 'latest'
      ? Effect.succeed([])
      : source.api.loadItemVersions(reference, source.sessionToken);
  const result = await runExplorerQuery(
    Effect.all(
      [versions, source.api.loadItemPublishings(reference, source.sessionToken)] as const,
      { concurrency: 2 },
    ).pipe(withRequestPriority({ kind: 'background', standing })),
  );
  const status = publicationStatus(
    contentItemVersionNumber(item),
    result[0],
    result[1],
    new Date(),
  );
  if (!status) throw new Error('No saved version is available.');
  return status;
}

export function clearPublicationStatusCacheOutsideScope(
  queryClient: QueryClient,
  scope: {
    readonly credentialRevision: string;
    readonly deployment: Deployment | undefined;
    readonly instanceZuid: InstanceZuid | undefined;
  },
): void {
  queryClient.removeQueries({
    queryKey: publicationStatusQueryPrefix,
    predicate: (query) =>
      query.queryKey[1] !== scope.credentialRevision ||
      query.queryKey[2] !== scope.deployment ||
      query.queryKey[3] !== scope.instanceZuid,
  });
}

/** How many cells on or near the screen show each status query, by query hash. */
const cellsOnScreen = new Map<string, number>();

/** Counts one cell that shows a status on or near the screen, until the returned function runs. */
export function countStatusOnScreen(queryHash: string): () => void {
  cellsOnScreen.set(queryHash, (cellsOnScreen.get(queryHash) ?? 0) + 1);
  return () => {
    const count = (cellsOnScreen.get(queryHash) ?? 1) - 1;
    if (count) cellsOnScreen.set(queryHash, count);
    else cellsOnScreen.delete(queryHash);
  };
}

export function isStatusOnScreen(queryHash: string): boolean {
  return cellsOnScreen.has(queryHash);
}

/**
 * Reloads the statuses on screen and reports whether they all loaded. Statuses below the screen
 * reload in the background, so Refresh does not wait for whole tables.
 */
export async function refreshActivePublicationStatuses(queryClient: QueryClient): Promise<boolean> {
  const onScreen = (query: Query) => isStatusOnScreen(query.queryHash);
  void queryClient.refetchQueries({
    queryKey: publicationStatusQueryPrefix,
    type: 'active',
    predicate: (query) => !onScreen(query),
  });
  await queryClient.refetchQueries({
    queryKey: publicationStatusQueryPrefix,
    type: 'active',
    predicate: onScreen,
  });
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: publicationStatusQueryPrefix, type: 'active', predicate: onScreen })
    .every((query) => query.state.status !== 'error');
}
