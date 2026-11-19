import {
  hashKey,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { ContentItem, ContentItemReference, ContentItemVersion } from '../../domain';
import type { BackgroundStanding } from '../../zesty-api';
import { explorerFailure } from '../hooks/explorer-query';
import { modelPublicationsQuery } from '../hooks/model-publications-query';
import {
  countStatusOnScreen,
  isStatusOnScreen,
  loadSavedVersions,
  savedVersionsQueryPrefix,
  type PublicationStatusSource,
} from '../hooks/publication-status-query';
import { useNearViewport } from '../hooks/useNearViewport';
import { contentItemVersionNumber } from '../item-version-preview';
import { publicationStatus, type PublicationStatus } from '../publication-status';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { TooltipTrigger } from './ui/tooltip';

const cacheTime = 5 * 60 * 1_000;
/** A latest saved item is its own latest version, so its status reads no version history. */
const latestHasNoHistory: readonly Pick<ContentItemVersion, 'number'>[] = [];
const StatusSourceContext = createContext<PublicationStatusSource | null>(null);

// Saved versions load newest render group first, so rows the user opened last load first.
let lastGroup = 0;
let renderGroup: number | undefined;
/** One request group for every cell mounted in the same render, newer than any earlier render. */
function currentRenderGroup(): number {
  if (renderGroup === undefined) {
    lastGroup += 1;
    renderGroup = lastGroup;
    queueMicrotask(() => {
      renderGroup = undefined;
    });
  }
  return renderGroup;
}
/** The newest group that shows each saved-versions query, so a queued load moves up when a newer row shows it. */
const newestGroups = new Map<string, number>();
/** The latest load of each saved-versions query; an earlier load still queued is not needed. */
const latestLoads = new Map<string, symbol>();

/**
 * Where a queued saved-versions load stands each time the request budget picks the next request.
 * Rows on or near the screen load first, then the rest of the table in the background. A load no
 * cell shows any more, or one a later load replaced, leaves the queue unsent; one already sent
 * finishes.
 */
function statusStanding(
  queryClient: QueryClient,
  queryHash: string,
  load: symbol,
  group: number,
): BackgroundStanding {
  if (
    latestLoads.get(queryHash) !== load ||
    // A row of a latest view still observes the query, disabled, and needs no saved versions.
    !queryClient.getQueryCache().get(queryHash)?.isActive()
  ) {
    return { kind: 'dropped' };
  }
  const rank = newestGroups.get(queryHash) ?? group;
  return isStatusOnScreen(queryHash) ? { kind: 'needed', rank } : { kind: 'prefetch', rank };
}

export function PublicationStatusProvider({
  api,
  sessionToken,
  credentialRevision,
  contentState,
  children,
}: PublicationStatusSource & { readonly children: ReactNode }) {
  return (
    <StatusSourceContext value={{ api, sessionToken, credentialRevision, contentState }}>
      {children}
    </StatusSourceContext>
  );
}

function formatPublishTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

// Only the version number, colored by its role; the tooltip and accessible name say what it is.
// A tab stop, so keyboard users can reach the tooltip.
function StatusBadge({
  version,
  description,
  className,
}: {
  readonly version: number;
  readonly description: string;
  readonly className: string;
}) {
  return (
    <TooltipTrigger
      text={description}
      render={<Badge role="img" aria-label={description} tabIndex={0} className={className} />}
    >
      v{version}
    </TooltipTrigger>
  );
}

interface PublicationStatusCellProps {
  readonly item: ContentItem;
  readonly reference: ContentItemReference;
}

/**
 * The item's saved versions, for a published view only: its rows show the published version, so
 * the latest saved one is read per item, queued behind rows on or near the screen. A row of a latest
 * view is its latest saved version and records it, so switching to Published needs no request.
 */
function useSavedVersions(
  source: PublicationStatusSource,
  item: ContentItem,
  reference: ContentItemReference,
  cell: RefObject<HTMLElement | null>,
) {
  const enabled = source.contentState === 'published';
  const near = useNearViewport(cell);
  const queryClient = useQueryClient();
  const [group] = useState(currentRenderGroup);
  const queryKey = useMemo(
    () => [
      ...savedVersionsQueryPrefix,
      source.credentialRevision,
      reference.deployment,
      reference.instanceZuid,
      reference.modelZuid,
      reference.itemZuid,
    ],
    [source.credentialRevision, reference],
  );
  const queryHash = hashKey(queryKey);
  const latestVersion = enabled ? undefined : contentItemVersionNumber(item);
  useEffect(() => {
    if (latestVersion !== undefined)
      queryClient.setQueryData(queryKey, [{ number: latestVersion }]);
  }, [latestVersion, queryClient, queryKey]);
  useEffect(() => {
    if (!enabled) return;
    newestGroups.set(queryHash, Math.max(group, newestGroups.get(queryHash) ?? 0));
  }, [enabled, group, queryHash]);
  useEffect(() => {
    if (enabled && near) return countStatusOnScreen(queryHash);
  }, [enabled, near, queryHash]);
  return useQuery({
    queryKey,
    // The query function ignores TanStack's abort signal, so unmounting a row never aborts a sent
    // request; the budget drops a request that has not been sent yet.
    queryFn: () => {
      const load = Symbol(queryHash);
      latestLoads.set(queryHash, load);
      return loadSavedVersions(source, reference, () =>
        statusStanding(queryClient, queryHash, load, group),
      );
    },
    enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: cacheTime,
  });
}

/** A failure to show, or undefined; a load dropped unsent while no row showed it is no failure. */
function shownFailure(query: UseQueryResult<unknown>): UseQueryResult<unknown> | undefined {
  return query.isError && explorerFailure(query.error)?.kind !== 'cancelled' ? query : undefined;
}

function ConnectedPublicationStatusCell({
  source,
  item,
  reference,
}: PublicationStatusCellProps & { readonly source: PublicationStatusSource }) {
  const cell = useRef<HTMLSpanElement>(null);
  const publications = useQuery(modelPublicationsQuery(source, reference));
  const savedVersions = useSavedVersions(source, item, reference, cell);
  const versions = source.contentState === 'published' ? savedVersions.data : latestHasNoHistory;
  const status = useMemo(
    () =>
      publications.data && versions
        ? (publicationStatus(
            contentItemVersionNumber(item),
            versions,
            publications.data.get(reference.itemZuid) ?? [],
            new Date(),
          ) ?? null)
        : undefined,
    [item, publications.data, reference.itemZuid, versions],
  );
  const failed = shownFailure(publications) ?? shownFailure(savedVersions);

  return (
    // Pills wrap rather than draw over the next column if the column is made narrow.
    <span ref={cell} className="flex min-w-0 flex-wrap items-center gap-1.5">
      {failed ? (
        <>
          <span className="text-muted-foreground">Unavailable</span>
          <Button variant="ghost" size="sm" onClick={() => void failed.refetch()}>
            Retry
          </Button>
        </>
      ) : status === null ? (
        // Zesty listed the item without a version, so there is nothing to compare.
        <span className="text-muted-foreground">Unavailable</span>
      ) : (
        <StatusContent status={status} publishedFirst={source.contentState === 'published'} />
      )}
    </span>
  );
}

// In a published view the row shows the published version, so its pill leads.
function StatusContent({
  status,
  publishedFirst,
}: {
  readonly status: PublicationStatus | undefined;
  readonly publishedFirst: boolean;
}) {
  // A row keeps what it had while a load is dropped unsent, and a row without a status loads it
  // again when shown.
  if (status === undefined) {
    return (
      // Two pills, the usual shape, so a waiting row keeps the cell's width.
      <span className="flex gap-1.5" role="status" aria-label="Loading publication status">
        <Skeleton className="h-4.5 w-8 rounded-full" />
        <Skeleton className="h-4.5 w-8 rounded-full" />
      </span>
    );
  }

  const published = status.currentlyPublished;
  const scheduled = status.nextScheduled;
  const scheduledBadge = (version: number, publishAt: string, latest: boolean) => (
    <StatusBadge
      version={version}
      description={`${latest ? 'Latest saved version' : 'Version'} v${version} scheduled to publish ${formatPublishTime(publishAt)}`}
      className="border-amber-500/40 bg-amber-500/10 text-amber-300"
    />
  );
  if (published === status.latestSaved) {
    return (
      <>
        <StatusBadge
          version={published}
          description={`Version v${published} is the latest saved and currently published version`}
          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
        />
        {scheduled ? scheduledBadge(scheduled.version, scheduled.publishAt, false) : null}
      </>
    );
  }
  // A scheduled latest version says so in its own pill instead of repeating it.
  const latest =
    scheduled?.version === status.latestSaved ? (
      scheduledBadge(scheduled.version, scheduled.publishAt, true)
    ) : (
      <StatusBadge
        version={status.latestSaved}
        description={`Latest saved version v${status.latestSaved}`}
        className="border-sky-500/40 bg-sky-500/10 text-sky-300"
      />
    );
  const live =
    published === undefined ? null : (
      <StatusBadge
        version={published}
        description={`Currently published version v${published}`}
        className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      />
    );
  return (
    <>
      {publishedFirst ? live : latest}
      {publishedFirst ? latest : live}
      {scheduled && scheduled.version !== status.latestSaved
        ? scheduledBadge(scheduled.version, scheduled.publishAt, false)
        : null}
    </>
  );
}

export function PublicationStatusCell(props: PublicationStatusCellProps) {
  const source = useContext(StatusSourceContext);
  if (!source) return null;
  return <ConnectedPublicationStatusCell source={source} {...props} />;
}
