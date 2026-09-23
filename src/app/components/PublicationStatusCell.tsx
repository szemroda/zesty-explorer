import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import type { ContentItem, ContentItemReference } from '../../domain';
import {
  loadPublicationStatus,
  publicationStatusQueryPrefix,
  type PublicationStatusSource,
} from '../hooks/publication-status-query';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

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
    <Badge role="img" aria-label={description} title={description} className={className}>
      v{version}
    </Badge>
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
  const query = useQuery({
    queryKey: [
      ...publicationStatusQueryPrefix,
      source.credentialRevision,
      reference.deployment,
      reference.instanceZuid,
      reference.modelZuid,
      reference.itemZuid,
    ],
    queryFn: ({ signal }) => loadPublicationStatus(source, reference, item, signal),
    retry: false,
    staleTime: Infinity,
    gcTime: cacheTime,
  });

  if (query.isPending) {
    return (
      <span role="status" aria-label="Loading publication status">
        Loading...
      </span>
    );
  }
  if (query.isError) {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        Unavailable
        <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </span>
    );
  }

  const status = query.data;
  return (
    <span className="flex items-center gap-1.5">
      <StatusBadge
        version={status.latestSaved}
        description={`Latest saved version v${status.latestSaved}`}
        className="border-sky-500/40 bg-sky-500/10 text-sky-300"
      />
      {status.currentlyPublished === undefined ? null : (
        <StatusBadge
          version={status.currentlyPublished}
          description={`Currently published version v${status.currentlyPublished}`}
          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
        />
      )}
      {status.nextScheduled ? (
        <StatusBadge
          version={status.nextScheduled.version}
          description={`Version v${status.nextScheduled.version} scheduled to publish ${formatPublishTime(status.nextScheduled.publishAt)}`}
          className="border-amber-500/40 bg-amber-500/10 text-amber-300"
        />
      ) : null}
    </span>
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
