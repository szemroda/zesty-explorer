import type {
  ContentItem,
  ContentItemVersion,
  InstanceUser,
  ItemPublishing,
  UserZuid,
} from '../domain';

export type VersionAuthorState = 'loading' | 'resolved' | 'unavailable';

export interface VersionPreviewOption {
  readonly number: number;
  readonly item: ContentItem;
  readonly savedAt?: string;
  readonly author?: string;
  readonly authorState: VersionAuthorState;
  readonly latestSaved: boolean;
  readonly currentlyPublished: boolean;
  readonly scheduledAt?: string;
  readonly additionalSchedules: number;
  readonly currentInView: boolean;
}

export interface BuildVersionPreviewOptionsInput {
  readonly currentItem: ContentItem;
  readonly versions: readonly ContentItemVersion[];
  readonly publishings: readonly ItemPublishing[];
  readonly users: readonly InstanceUser[];
  readonly usersState: 'loading' | 'ready' | 'failed';
  readonly now: Date;
}

export function contentItemVersionNumber(item: ContentItem): number | undefined {
  const version = item.metadata.version;
  return typeof version === 'number' && Number.isFinite(version) ? version : undefined;
}

function rawRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function isUserZuid(value: unknown): value is UserZuid {
  return typeof value === 'string' && (value.startsWith('5-') || value.startsWith('55-'));
}

function currentItemVersion(item: ContentItem): ContentItemVersion | undefined {
  const number = contentItemVersionNumber(item);
  if (number === undefined) return undefined;
  const web = rawRecord(item.raw.web);
  const meta = rawRecord(item.raw.meta);
  const savedAt =
    typeof web?.createdAt === 'string'
      ? web.createdAt
      : typeof item.metadata.modified === 'string'
        ? item.metadata.modified
        : typeof meta?.updatedAt === 'string'
          ? meta.updatedAt
          : undefined;
  const rawAuthorZuid = web?.createdByUserZUID ?? meta?.createdByUserZUID;
  const authorZuid = isUserZuid(rawAuthorZuid) ? rawAuthorZuid : undefined;

  return {
    number,
    ...(savedAt ? { savedAt } : {}),
    ...(authorZuid ? { authorZuid } : {}),
    item,
  };
}

function displayName(user: InstanceUser | undefined): string | undefined {
  if (!user) return undefined;
  const firstName = user.firstName?.trim();
  const lastName = user.lastName?.trim();
  if (firstName && lastName) return `${firstName} ${lastName}`;
  return user.email?.trim() || undefined;
}

function authorFor(
  version: ContentItemVersion,
  usersById: ReadonlyMap<UserZuid, InstanceUser>,
  usersState: BuildVersionPreviewOptionsInput['usersState'],
): Pick<VersionPreviewOption, 'author' | 'authorState'> {
  if (!version.authorZuid) return { authorState: 'unavailable' };
  const author = displayName(usersById.get(version.authorZuid));
  if (author) return { author, authorState: 'resolved' };
  return { authorState: usersState === 'loading' ? 'loading' : 'unavailable' };
}

function futureSchedules(
  publishings: readonly ItemPublishing[],
  version: number,
  now: Date,
): readonly string[] {
  const nowMs = now.getTime();
  return publishings
    .filter(
      (publishing) =>
        publishing.version === version &&
        !publishing.active &&
        publishing.publishAt !== undefined &&
        Number.isFinite(Date.parse(publishing.publishAt)) &&
        Date.parse(publishing.publishAt) > nowMs,
    )
    .map((publishing) => publishing.publishAt!)
    .toSorted((left, right) => Date.parse(left) - Date.parse(right));
}

export function buildVersionPreviewOptions({
  currentItem,
  versions,
  publishings,
  users,
  usersState,
  now,
}: BuildVersionPreviewOptionsInput): readonly VersionPreviewOption[] {
  const current = currentItemVersion(currentItem);
  const byNumber = new Map(versions.map((version) => [version.number, version]));
  if (current && !byNumber.has(current.number)) byNumber.set(current.number, current);

  const ordered = [...byNumber.values()].toSorted((left, right) => right.number - left.number);
  const latestNumber = ordered[0]?.number;
  const usersById = new Map(users.map((user) => [user.id, user]));
  const activeVersions = new Set(
    publishings.filter((publishing) => publishing.active).map((publishing) => publishing.version),
  );

  return ordered.map((version) => {
    const schedules = futureSchedules(publishings, version.number, now);
    const scheduledAt = schedules[0];
    return {
      number: version.number,
      item: version.item,
      ...(version.savedAt ? { savedAt: version.savedAt } : {}),
      ...authorFor(version, usersById, usersState),
      latestSaved: version.number === latestNumber,
      currentlyPublished: activeVersions.has(version.number),
      ...(scheduledAt ? { scheduledAt } : {}),
      additionalSchedules: Math.max(0, schedules.length - 1),
      currentInView: version.number === current?.number,
    };
  });
}

export function matchesVersionPreviewOption(option: VersionPreviewOption, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const searchable = [
    `version ${option.number}`,
    `v${option.number}`,
    option.author,
    option.latestSaved ? 'latest saved latest' : undefined,
    option.currentlyPublished ? 'currently published published' : undefined,
    option.scheduledAt ? 'scheduled' : undefined,
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
  return searchable.includes(normalized);
}
