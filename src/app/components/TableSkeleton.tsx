import { Skeleton } from './ui/skeleton';

// Placeholder rows in the content table layout while a collection loads.
export function TableSkeleton({ label, rows }: { readonly label: string; readonly rows: number }) {
  return (
    <div role="status" aria-label={label}>
      <div className="h-9 border-b border-divider-subtle bg-surface-header" />
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="flex h-11 items-center gap-6 border-b border-divider-subtle px-3 last:border-b-0"
        >
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
