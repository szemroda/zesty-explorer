import type { QueryClient } from '@tanstack/react-query';
import { Effect, Either } from 'effect';
import type { ContentItem, ContentItemReference, Deployment, InstanceZuid } from '../../domain';
import type { ItemVersionApi } from '../../zesty-api';
import { contentItemVersionNumber } from '../item-version-preview';
import { publicationStatus, type PublicationStatus } from '../publication-status';

export const publicationStatusQueryPrefix = ['publication-status'] as const;
const maxConcurrentItems = 4;
let activeItems = 0;
const waiting: Array<{
  readonly resolve: () => void;
  readonly reject: (reason: Error) => void;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}> = [];

export interface PublicationStatusSource {
  readonly api: ItemVersionApi;
  readonly sessionToken: string;
  readonly credentialRevision: string;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

async function withRequestSlot<Value>(
  work: () => Promise<Value>,
  signal: AbortSignal,
): Promise<Value> {
  if (signal.aborted) throw abortError(signal);
  if (activeItems < maxConcurrentItems) {
    activeItems += 1;
  } else {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const index = waiting.findIndex((entry) => entry.onAbort === onAbort);
        if (index >= 0) waiting.splice(index, 1);
        reject(abortError(signal));
      };
      waiting.push({ resolve, reject, signal, onAbort });
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  try {
    if (signal.aborted) throw abortError(signal);
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) {
      next.signal.removeEventListener('abort', next.onAbort);
      next.resolve();
    } else {
      activeItems -= 1;
    }
  }
}

export async function loadPublicationStatus(
  source: PublicationStatusSource,
  reference: ContentItemReference,
  item: ContentItem,
  signal: AbortSignal,
): Promise<PublicationStatus> {
  return withRequestSlot(async () => {
    const result = await Effect.runPromise(
      Effect.all(
        [
          source.api.loadItemVersions(reference, source.sessionToken),
          source.api.loadItemPublishings(reference, source.sessionToken),
        ] as const,
        { concurrency: 2 },
      ).pipe(Effect.either),
      { signal },
    );
    if (Either.isLeft(result)) throw new Error(result.left.message);
    const status = publicationStatus(
      contentItemVersionNumber(item),
      result.right[0],
      result.right[1],
      new Date(),
    );
    if (!status) throw new Error('No saved version is available.');
    return status;
  }, signal);
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
