import { useLayoutEffect, useState } from 'react';
import type { CollectionNodeId, ViewFilter } from '../../domain';

// Which column headers are on screen, per table node, so the chip row can skip the filters a header
// already shows. A filter whose column is hidden, or whose table is not on screen, stays a chip.
// Nested tables of one node share their columns, so headers are counted across them.
const shownHeaders = new Map<CollectionNodeId, Map<string, number>>();
const headerListeners = new Set<() => void>();

function notifyHeaderListeners() {
  headerListeners.forEach((listener) => listener());
}

/** Counts a column header as on screen while it is mounted. */
export function useShownHeader(nodeId: CollectionNodeId, columnId: string) {
  useLayoutEffect(() => {
    const counts = shownHeaders.get(nodeId) ?? new Map<string, number>();
    shownHeaders.set(nodeId, counts);
    counts.set(columnId, (counts.get(columnId) ?? 0) + 1);
    notifyHeaderListeners();
    return () => {
      const count = (counts.get(columnId) ?? 1) - 1;
      if (count > 0) counts.set(columnId, count);
      else counts.delete(columnId);
      notifyHeaderListeners();
    };
  }, [nodeId, columnId]);
}

function readShownColumns(nodeId: CollectionNodeId): ReadonlySet<string> {
  return new Set(shownHeaders.get(nodeId)?.keys());
}

// Layout effects, so the chip row settles before paint: it sits above the grid, so it subscribes
// before the grid's headers register in the same commit.
function useShownColumns(nodeId: CollectionNodeId): ReadonlySet<string> {
  const [columns, setColumns] = useState(() => readShownColumns(nodeId));
  useLayoutEffect(() => {
    const update = () => setColumns(readShownColumns(nodeId));
    headerListeners.add(update);
    return () => {
      headerListeners.delete(update);
    };
  }, [nodeId]);
  return columns;
}

/** One filter of the table's list, with the column whose header shows it, if any. */
export interface ListedFilter {
  readonly filter: ViewFilter;
  readonly columnId: string | undefined;
}

/** The filters of `entries` that no column header on screen shows. */
export function useUnshownFilters(
  nodeId: CollectionNodeId,
  entries: readonly ListedFilter[],
): readonly ListedFilter[] {
  const shown = useShownColumns(nodeId);
  return entries.filter(({ columnId }) => columnId === undefined || !shown.has(columnId));
}
