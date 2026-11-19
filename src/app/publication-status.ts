import type { ContentItemVersion, ItemPublishing, ItemZuid, ModelPublishing } from '../domain';

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

/**
 * Each item's live and upcoming publishings, from a model's bulk records, in the shape
 * `publicationStatus` reads. A record whose window ended is history the status never reads.
 */
export function currentPublishings(
  records: readonly ModelPublishing[],
  now: Date,
): ReadonlyMap<ItemZuid, readonly ItemPublishing[]> {
  const time = now.getTime();
  const byItem = new Map<ItemZuid, ItemPublishing[]>();
  for (const { itemZuid, version, publishAt, unpublishAt } of records) {
    if (unpublishAt !== undefined && Date.parse(unpublishAt) <= time) continue;
    const publishing: ItemPublishing = {
      version,
      publishAt,
      ...(unpublishAt ? { unpublishAt } : {}),
      active: Date.parse(publishAt) <= time,
    };
    const list = byItem.get(itemZuid);
    if (list) list.push(publishing);
    else byItem.set(itemZuid, [publishing]);
  }
  return byItem;
}
