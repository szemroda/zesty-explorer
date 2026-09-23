import type { ContentItemVersion, ItemPublishing } from '../domain';

export interface PublicationStatus {
  readonly latestSaved: number;
  readonly currentlyPublished?: number;
  readonly nextScheduled?: { readonly version: number; readonly publishAt: string };
}

export function publicationStatus(
  currentVersion: number | undefined,
  versions: readonly Pick<ContentItemVersion, 'number'>[],
  publishings: readonly ItemPublishing[],
  now: Date,
): PublicationStatus | undefined {
  const latestSaved = Math.max(
    currentVersion ?? -Infinity,
    ...versions.map(({ number }) => number),
  );
  if (!Number.isFinite(latestSaved)) return undefined;

  const currentlyPublished = publishings.find(({ active }) => active)?.version;
  const nextScheduled = publishings
    .filter(
      ({ active, publishAt }) =>
        !active && publishAt !== undefined && Date.parse(publishAt) > now.getTime(),
    )
    .toSorted((left, right) => Date.parse(left.publishAt!) - Date.parse(right.publishAt!))[0];

  return {
    latestSaved,
    ...(currentlyPublished === undefined ? {} : { currentlyPublished }),
    ...(nextScheduled?.publishAt
      ? { nextScheduled: { version: nextScheduled.version, publishAt: nextScheduled.publishAt } }
      : {}),
  };
}
