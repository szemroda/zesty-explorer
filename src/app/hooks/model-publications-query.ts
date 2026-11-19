import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { CollectionReference, Deployment, InstanceZuid } from '../../domain';
import type { ModelPublishingApi } from '../../zesty-api';
import { currentPublishings } from '../publication-status';
import { runExplorerQuery } from './explorer-query';

export const modelPublicationsQueryPrefix = ['model-publications'] as const;

export interface ModelPublicationsSource {
  readonly api: ModelPublishingApi;
  readonly sessionToken: string;
  readonly credentialRevision: string;
}

/**
 * One model's live and upcoming publishings per item, in every language, from a single paged
 * read of its bulk records. The live window is judged when the records load.
 */
export function modelPublicationsQuery(
  source: ModelPublicationsSource,
  reference: CollectionReference,
) {
  return queryOptions({
    queryKey: [
      ...modelPublicationsQueryPrefix,
      source.credentialRevision,
      reference.deployment,
      reference.instanceZuid,
      reference.modelZuid,
    ] as const,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    // A model can hold tens of thousands of items; comparing a reload entry by entry is wasted work.
    structuralSharing: false,
    queryFn: async ({ signal }) =>
      currentPublishings(
        await runExplorerQuery(
          source.api.loadModelPublishings(reference, source.sessionToken),
          signal,
        ),
        new Date(),
      ),
  });
}

/** Reloads the publications shown now and reports whether they all loaded. */
export async function refreshActiveModelPublications(queryClient: QueryClient): Promise<boolean> {
  await queryClient.refetchQueries({ queryKey: modelPublicationsQueryPrefix, type: 'active' });
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: modelPublicationsQueryPrefix, type: 'active' })
    .every((query) => query.state.status !== 'error');
}

/** Drops publications read with another session or for another instance. */
export function clearModelPublicationsOutsideScope(
  queryClient: QueryClient,
  scope: {
    readonly credentialRevision: string;
    readonly deployment: Deployment | undefined;
    readonly instanceZuid: InstanceZuid | undefined;
  },
): void {
  queryClient.removeQueries({
    queryKey: modelPublicationsQueryPrefix,
    predicate: (query) =>
      query.queryKey[1] !== scope.credentialRevision ||
      query.queryKey[2] !== scope.deployment ||
      query.queryKey[3] !== scope.instanceZuid,
  });
}
