import type { Query, QueryClient } from '@tanstack/react-query';
import type {
  ContentItemReference,
  ContentItemVersion,
  ContentState,
  Deployment,
  InstanceZuid,
} from '../../domain';
import { withRequestPriority, type BackgroundStanding, type ItemVersionApi } from '../../zesty-api';
import { runExplorerQuery } from './explorer-query';
import type { ModelPublicationsSource } from './model-publications-query';

/** Per-item saved versions, which a published view needs on top of its model's publications. */
export const savedVersionsQueryPrefix = ['saved-versions'] as const;

export interface PublicationStatusSource extends ModelPublicationsSource {
  readonly api: ModelPublicationsSource['api'] & ItemVersionApi;
  /**
   * The view's content state. Latest saved items carry their own latest version, so their status
   * comes from the model's publications alone; published items also need their saved versions.
   */
  readonly contentState: ContentState;
}

/**
 * Loads the version numbers saved for one item as background work, queued by `standing`. It takes
 * no abort signal: a request that was sent runs to the end, and work no one needs is dropped
 * while queued.
 */
export async function loadSavedVersions(
  source: PublicationStatusSource,
  reference: ContentItemReference,
  standing: () => BackgroundStanding,
): Promise<readonly Pick<ContentItemVersion, 'number'>[]> {
  const versions = await runExplorerQuery(
    source.api
      .loadItemVersions(reference, source.sessionToken)
      .pipe(withRequestPriority({ kind: 'background', standing })),
  );
  // Only the numbers stay cached, not every version's content.
  return versions.map(({ number }) => ({ number }));
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
    queryKey: savedVersionsQueryPrefix,
    predicate: (query) =>
      query.queryKey[1] !== scope.credentialRevision ||
      query.queryKey[2] !== scope.deployment ||
      query.queryKey[3] !== scope.instanceZuid,
  });
}

/** How many cells on or near the screen show each saved-versions query, by query hash. */
const cellsOnScreen = new Map<string, number>();

/** Counts one cell that shows saved versions on or near the screen, until the returned function runs. */
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
 * Reloads the saved versions on screen and reports whether they all loaded. The ones below the
 * screen reload in the background, so Refresh does not wait for whole tables. The model
 * publications that every status also reads refresh with `refreshActiveModelPublications`.
 */
export async function refreshActivePublicationStatuses(queryClient: QueryClient): Promise<boolean> {
  const onScreen = (query: Query) => isStatusOnScreen(query.queryHash);
  void queryClient.refetchQueries({
    queryKey: savedVersionsQueryPrefix,
    type: 'active',
    predicate: (query) => !onScreen(query),
  });
  await queryClient.refetchQueries({
    queryKey: savedVersionsQueryPrefix,
    type: 'active',
    predicate: onScreen,
  });
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: savedVersionsQueryPrefix, type: 'active', predicate: onScreen })
    .every((query) => query.state.status !== 'error');
}
