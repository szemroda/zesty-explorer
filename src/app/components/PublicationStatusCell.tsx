import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { ContentItem, ContentItemReference } from '../../domain';
import {
  loadPublicationStatus,
  publicationStatusQueryPrefix,
  type PublicationStatusSource,
} from '../hooks/publication-status-query';
import { useNearViewport } from '../hooks/useNearViewport';
import type { PublicationStatus } from '../publication-status';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { TooltipTrigger } from './ui/tooltip';

const cacheTime = 5 * 60 * 1_000;
const StatusSourceContext = createContext<PublicationStatusSource | null>(null);

export function PublicationStatusProvider({
  api,
  sessionToken,
  credentialRevision,
  children,
}: PublicationStatusSource & { readonly children: ReactNode }) {
  return (
    <StatusSourceContext value={{ api, sessionToken, credentialRevision }}>
      {children}
    </StatusSourceContext>
  );
}

function formatPublishTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

// A version with the word for its role, so the cell reads without hovering. The tooltip adds detail.
function StatusBadge({
  version,
  role,
  description,
  className,
}: {
  readonly version: number;
  readonly role: string;
  readonly description: string;
  readonly className: string;
}) {
  return (
    <TooltipTrigger
      text={description}
      render={<Badge role="img" aria-label={description} className={className} />}
    >
      v{version} <span className="font-normal opacity-80">{role}</span>
    </TooltipTrigger>
  );
}

function ConnectedPublicationStatusCell({
  source,
  item,
  reference,
}: {
  readonly source: PublicationStatusSource;
  readonly item: ContentItem;
  readonly reference: ContentItemReference;
}) {
  const cell = useRef<HTMLSpanElement>(null);
  // Each status costs two rate-limited requests, so only rows on or near the screen ask for theirs.
  // A row scrolled past before its turn gives up its place in the queue and asks again on return.
  const near = useNearViewport(cell);
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => [
      ...publicationStatusQueryPrefix,
      source.credentialRevision,
      reference.deployment,
      reference.instanceZuid,
      reference.modelZuid,
      reference.itemZuid,
    ],
    [source.credentialRevision, reference],
  );
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => loadPublicationStatus(source, reference, item, signal),
    enabled: near,
    retry: false,
    staleTime: Infinity,
    gcTime: cacheTime,
  });
  const abandoned = !near && query.isPending && query.isFetching;
  useEffect(() => {
    if (abandoned) void queryClient.cancelQueries({ queryKey, exact: true });
  }, [abandoned, queryClient, queryKey]);

  return (
    <span ref={cell} className="flex items-center gap-1.5">
      <StatusContent query={query} />
    </span>
  );
}

function StatusContent({ query }: { readonly query: UseQueryResult<PublicationStatus> }) {
  if (query.isPending) {
    return (
      <Skeleton
        className="h-4.5 w-12 rounded-full"
        role="status"
        aria-label="Loading publication status"
      />
    );
  }
  if (query.isError) {
    return (
      <>
        <span className="text-muted-foreground">Unavailable</span>
        <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </>
    );
  }

  const status = query.data;
  const published = status.currentlyPublished;
  return (
    <>
      {published === status.latestSaved ? (
        <StatusBadge
          version={published}
          role="published"
          description={`Version v${published} is the latest saved and currently published version`}
          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
        />
      ) : (
        <>
          <StatusBadge
            version={status.latestSaved}
            role="saved"
            description={`Latest saved version v${status.latestSaved}`}
            className="border-sky-500/40 bg-sky-500/10 text-sky-300"
          />
          {published === undefined ? (
            <span className="text-muted-foreground text-xs">not published</span>
          ) : (
            <StatusBadge
              version={published}
              role="published"
              description={`Currently published version v${published}`}
              className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            />
          )}
        </>
      )}
      {status.nextScheduled ? (
        <StatusBadge
          version={status.nextScheduled.version}
          role="scheduled"
          description={`Version v${status.nextScheduled.version} scheduled to publish ${formatPublishTime(status.nextScheduled.publishAt)}`}
          className="border-amber-500/40 bg-amber-500/10 text-amber-300"
        />
      ) : null}
    </>
  );
}

export function PublicationStatusCell({
  item,
  reference,
}: {
  readonly item: ContentItem;
  readonly reference: ContentItemReference;
}) {
  const source = useContext(StatusSourceContext);
  if (!source) return null;
  return <ConnectedPublicationStatusCell source={source} item={item} reference={reference} />;
}
