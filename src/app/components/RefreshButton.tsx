import { RefreshCw } from 'lucide-react';
import { Button } from './ui/button';

/** The header's Refresh button: it spins while `refreshing` and marks a failed last refresh. */
export function RefreshButton({
  refreshing,
  failed = false,
  onRefresh,
}: {
  readonly refreshing: boolean;
  readonly failed?: boolean;
  readonly onRefresh: () => void;
}) {
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="relative"
        onClick={onRefresh}
        disabled={refreshing}
        aria-describedby={failed ? 'refresh-status' : undefined}
        {...(failed ? { 'data-refresh-failed': '' } : {})}
      >
        <RefreshCw
          className={refreshing ? 'animate-spin' : undefined}
          size={14}
          aria-hidden="true"
        />
        Refresh
        {failed ? (
          <span
            className="bg-destructive absolute -top-1 -right-1 size-2 rounded-full"
            aria-hidden="true"
          />
        ) : null}
      </Button>
      {failed ? (
        <span id="refresh-status" className="sr-only" role="status">
          The last refresh failed. Activate Refresh to retry.
        </span>
      ) : null}
    </>
  );
}
