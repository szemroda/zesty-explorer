import {
  type ColumnSizingState,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import { ListFilter, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  CollectionNode,
  CollectionNodeId,
  CollectionReference,
  CollectionSchema,
  CollectionSnapshot,
  ContentItem,
  ContentState,
  NodePresentation,
  ViewFilter,
} from '../../domain';
import { filterNodeItemIds, sortItemIds } from '../../explorer-core';
import {
  contentActionColumnWidth,
  createContentTableColumns,
  useContentTable,
} from '../content-table-model';
import {
  columnIdForSort,
  contentItemColumns,
  initialColumnVisibility,
  sortForColumn,
  visibleColumnIds,
} from '../content-item-presentation';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { buildLoadedViewGraph, type LoadedView } from '../load-view';
import { CellValue } from './CellValue';
import { ContentColumnsMenu, ContentTableGrid, ContentTablePagination } from './ContentTable';
import { FilterBuilder } from './FilterBuilder';
import { NestedTable, type SharedNodeTableState } from './NestedTable';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Input } from './ui/input';

interface RootTableProps {
  readonly schema: CollectionSchema;
  readonly snapshot: CollectionSnapshot;
  readonly reference: CollectionReference;
  readonly treeRoot: CollectionNode;
  readonly loadedView: LoadedView;
  readonly contentState: ContentState;
  readonly globalFreeText?: string;
  readonly viewFilters?: readonly ViewFilter[];
  readonly onOpenDetails: (item: ContentItem, trigger: HTMLElement) => void;
  readonly onRetry: () => void;
  readonly onPresentationChange: (nodeId: CollectionNodeId, presentation: NodePresentation) => void;
}

export function RootTable({
  schema,
  snapshot,
  reference,
  treeRoot,
  loadedView,
  contentState,
  globalFreeText = '',
  viewFilters = [],
  onOpenDetails,
  onRetry,
  onPresentationChange,
}: RootTableProps) {
  const [nodeStates, setNodeStates] = useState<ReadonlyMap<CollectionNodeId, SharedNodeTableState>>(
    new Map(),
  );
  const [tableFreeText, setTableFreeText] = useState(treeRoot.presentation.freeText);
  const [filters, setFilters] = useState<readonly ViewFilter[]>(treeRoot.presentation.filters);
  const itemColumnDefinitions = useMemo(
    () => contentItemColumns(schema, snapshot.items),
    [schema, snapshot.items],
  );
  const [sorting, setSorting] = useState<SortingState>([
    {
      id: columnIdForSort(treeRoot.presentation.sort),
      desc: treeRoot.presentation.sort.direction === 'desc',
    },
  ]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
    treeRoot.presentation.columnWidths,
  );
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(() =>
    initialColumnVisibility(itemColumnDefinitions, treeRoot.presentation.visibleColumns),
  );
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 100 });
  const deferredTableText = useDebouncedValue(tableFreeText);
  const deferredGlobalText = useDebouncedValue(globalFreeText);

  useEffect(() => {
    if (treeRoot.presentation.freeText === tableFreeText) return;
    const timer = window.setTimeout(
      () =>
        onPresentationChange(treeRoot.id, {
          ...treeRoot.presentation,
          freeText: tableFreeText,
        }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [onPresentationChange, tableFreeText, treeRoot.id, treeRoot.presentation]);

  useEffect(() => {
    const active = sorting[0];
    const sort = sortForColumn(active?.id ?? '$modified', active?.desc === false ? 'asc' : 'desc');
    if (
      treeRoot.presentation.sort.direction === sort.direction &&
      treeRoot.presentation.sort.fieldPath.join('.') === sort.fieldPath.join('.')
    ) {
      return;
    }
    const timer = window.setTimeout(
      () =>
        onPresentationChange(treeRoot.id, {
          ...treeRoot.presentation,
          sort,
        }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [onPresentationChange, sorting, treeRoot.id, treeRoot.presentation]);

  const graph = useMemo(
    () => buildLoadedViewGraph(treeRoot, loadedView, contentState),
    [contentState, loadedView, treeRoot],
  );
  const filteredItems = useMemo(() => {
    const allIds = snapshot.items.map((item) => item.id);
    const viewIds = filterNodeItemIds(
      graph,
      treeRoot.id,
      allIds,
      viewFilters,
      deferredGlobalText.value,
    );
    const tableIds = filterNodeItemIds(
      graph,
      treeRoot.id,
      viewIds,
      filters,
      deferredTableText.value,
    );
    const activeSort = sorting[0];
    const sortedIds = sortItemIds(snapshot, tableIds, {
      ...sortForColumn(activeSort?.id ?? '$modified', activeSort?.desc === false ? 'asc' : 'desc'),
    });
    return sortedIds.flatMap((id) => {
      const item = snapshot.itemsById.get(id);
      return item ? [item] : [];
    });
  }, [
    deferredGlobalText.value,
    deferredTableText.value,
    filters,
    graph,
    snapshot,
    sorting,
    treeRoot.id,
    viewFilters,
  ]);
  const hasManagerLink = reference.area !== 'other';
  const canExpand = treeRoot.children.length > 0;
  const actionColumnWidth = contentActionColumnWidth(canExpand, hasManagerLink);

  const columns = useMemo(
    () =>
      createContentTableColumns({
        definitions: itemColumnDefinitions,
        actionColumnWidth,
        renderValue: (value) => <CellValue value={value} />,
      }),
    [actionColumnWidth, itemColumnDefinitions],
  );

  const table = useContentTable({
    data: filteredItems,
    columns,
    sorting,
    columnSizing,
    columnVisibility,
    pagination,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      setSorting(next);
    },
    onColumnSizingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnSizing) : updater;
      setColumnSizing(next);
      persistPresentation({ columnWidths: next });
    },
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnVisibility) : updater;
      setColumnVisibility(next);
      persistPresentation({
        visibleColumns: visibleColumnIds(itemColumnDefinitions, next),
      });
    },
    onPaginationChange: setPagination,
  });

  function persistPresentation(patch: Partial<NodePresentation>) {
    onPresentationChange(treeRoot.id, { ...treeRoot.presentation, ...patch });
  }

  function updateNodeState(nodeId: CollectionNodeId, state: SharedNodeTableState) {
    setNodeStates((current) => {
      const next = new Map(current);
      next.set(nodeId, state);
      return next;
    });
  }

  if (snapshot.items.length === 0)
    return (
      <div className="rounded-xl border border-border bg-panel p-7 text-center text-sm text-muted-foreground">
        This collection has no content items.
      </div>
    );

  return (
    <section
      className="relative min-w-0 overflow-visible rounded-xl border border-border bg-panel shadow-panel"
      aria-label={`${schema.label} collection`}
    >
      <div className="flex min-h-16 items-center justify-between gap-5 rounded-t-xl border-b border-border bg-surface-subtle px-3.5 py-3 pl-4.5 max-lg:items-start max-lg:flex-col">
        <div className="min-w-36">
          <h2 className="m-0 text-[17px] font-bold tracking-[-0.02em]">{schema.label}</h2>
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            {filteredItems.length} of {snapshot.items.length} items
          </span>
        </div>
        <div className="flex items-center gap-2 max-lg:w-full">
          <label className="flex h-10 min-w-56 items-center gap-2 rounded-lg border border-input bg-surface-control pl-3 text-muted-foreground transition-[border-color,box-shadow] focus-within:border-ring/70 focus-within:ring-3 focus-within:ring-ring/10">
            <Search
              className="text-foreground/70"
              size={15}
              strokeWidth={2.25}
              aria-hidden="true"
            />
            <Input
              className="h-[38px] min-h-0 min-w-0 border-0 bg-transparent px-0 pr-2.5 shadow-none focus-visible:border-0 focus-visible:ring-0"
              type="search"
              aria-label="Filter this table"
              placeholder="Search this collection"
              value={tableFreeText}
              onChange={(event) => setTableFreeText(event.target.value)}
            />
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" aria-label="Configure table filters">
                  <ListFilter size={14} /> Filters
                  {filters.length > 0 ? <Badge>{filters.length}</Badge> : null}
                </Button>
              }
            />
            <DropdownMenuContent
              align="end"
              className="w-[min(760px,calc(100vw-2rem))] min-w-0 p-0 lg:w-[min(760px,calc(100vw-330px))]"
            >
              <FilterBuilder
                label="Table filter"
                root={treeRoot}
                schemas={loadedView.schemas}
                filters={filters}
                onChange={(next) => {
                  setFilters(next);
                  persistPresentation({ filters: next });
                  setPagination((current) => ({ ...current, pageIndex: 0 }));
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <ContentColumnsMenu
            table={table}
            columns={itemColumnDefinitions}
            label="Choose visible columns"
          />
        </div>
      </div>
      {deferredTableText.showProgress || deferredGlobalText.showProgress ? (
        <div
          className="absolute top-16 right-3.5 z-4 rounded-b-md bg-divider-subtle px-2 py-1 text-[10px] text-muted-foreground"
          role="status"
        >
          Updating results...
        </div>
      ) : null}
      {snapshot.partial ? (
        <p
          className="m-0 border-b border-warning-border bg-warning px-3.5 py-2 text-xs text-warning-foreground"
          role="status"
        >
          Showing a partial collection. Results may be incomplete.
        </p>
      ) : null}
      <ContentTableGrid
        table={table}
        reference={reference}
        canExpand={canExpand}
        onOpenDetails={onOpenDetails}
        renderExpandedRow={(item) => (
          <div className="grid gap-2.5 border-l-3 border-accent/30 py-3 pr-3 pl-4.5">
            {treeRoot.children.map((child) => (
              <NestedTable
                key={child.id}
                node={child}
                parentNode={treeRoot}
                parentItemId={item.id}
                graph={graph}
                loadedView={loadedView}
                contentState={contentState}
                nodeStates={nodeStates}
                updateNodeState={updateNodeState}
                onPresentationChange={onPresentationChange}
                onOpenDetails={onOpenDetails}
                onRetry={onRetry}
              />
            ))}
          </div>
        )}
      />
      <ContentTablePagination table={table} itemCount={filteredItems.length} itemLabel="items" />
    </section>
  );
}
