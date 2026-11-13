import type { QueryClient } from '@tanstack/react-query';
import { Effect } from 'effect';
import type {
  ContentItem,
  ContentItemReference,
  ContentState,
  Deployment,
  InstanceZuid,
} from '../../domain';
import { withRequestPriority, type ItemVersionApi } from '../../zesty-api';
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

/** Loads one item's publication status as background work; a higher `group` loads first. */
export async function loadPublicationStatus(
  source: PublicationStatusSource,
  reference: ContentItemReference,
  item: ContentItem,
  group: () => number,
  signal: AbortSignal,
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
    ).pipe(withRequestPriority({ kind: 'background', group })),
    signal,
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

export async function refreshActivePublicationStatuses(queryClient: QueryClient): Promise<boolean> {
  await queryClient.refetchQueries({ queryKey: publicationStatusQueryPrefix, type: 'active' });
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: publicationStatusQueryPrefix, type: 'active' })
    .every((query) => query.state.status !== 'error');
}
