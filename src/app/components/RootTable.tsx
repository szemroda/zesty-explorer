import {
  type ColumnSizingState,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import { useEffect, useMemo, useState, type RefObject } from 'react';
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
import { buildLoadedViewGraph, type LoadedView } from '../load-view';
import { CellValue } from './CellValue';
import { ContentColumnsMenu, ContentTableGrid, ContentTablePagination } from './ContentTable';
import { tableFilterControls } from './FilterControls';
import { NestedTable, type SharedNodeTableState } from './NestedTable';
import { PublicationStatusCell } from './PublicationStatusCell';
import { ScrollDockProvider } from './ScrollDock';
import { TableSkeleton } from './TableSkeleton';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';

const panelClassName = 'min-w-0 rounded-xl border border-border bg-panel shadow-panel';
const headerClassName =
  'flex min-h-16 items-center justify-between gap-5 rounded-t-xl border-b border-border bg-surface-subtle px-3.5 py-3 pl-4.5 max-lg:items-start max-lg:flex-col';

// Stands in for RootTable, in the same panel and toolbar layout, while the root collection loads.
export function RootTableSkeleton() {
  return (
    <section className={`overflow-hidden ${panelClassName}`}>
      <div className={headerClassName}>
        <div className="grid gap-1.5">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-2.5 w-20" />
        </div>
        <div className="flex items-center gap-2 max-lg:w-full">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <TableSkeleton label="Loading collection" rows={8} />
    </section>
  );
}

interface RootTableProps {
  readonly schema: CollectionSchema;
  readonly snapshot: CollectionSnapshot;
  readonly reference: CollectionReference;
  readonly treeRoot: CollectionNode;
  readonly loadedView: LoadedView;
  readonly contentState: ContentState;
  /**
   * Related data the search or view filters need is still loading, so the current results may be
   * wrong. The toolbar and chips stay usable while the results wait.
   */
  readonly resultsPending?: boolean;
  readonly viewFilters?: readonly ViewFilter[];
  readonly onViewFiltersChange: (filters: readonly ViewFilter[]) => void;
  readonly onOpenDetails: (item: ContentItem, trigger: HTMLElement) => void;
  readonly onRetry: () => void;
  readonly onPresentationChange: (nodeId: CollectionNodeId, presentation: NodePresentation) => void;
  /** The page's sticky header; table headers stick below it. */
  readonly pageHeader: RefObject<HTMLElement | null>;
}

export function RootTable({
  schema,
  snapshot,
  reference,
  treeRoot,
  loadedView,
  contentState,
  resultsPending = false,
  viewFilters = [],
  onViewFiltersChange,
  onOpenDetails,
  onRetry,
  onPresentationChange,
  pageHeader,
}: RootTableProps) {
  const [nodeStates, setNodeStates] = useState<ReadonlyMap<CollectionNodeId, SharedNodeTableState>>(
    new Map(),
  );
  const { freeText } = treeRoot.presentation;
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
    initialColumnVisibility(
      itemColumnDefinitions,
      treeRoot.presentation.visibleColumns,
      treeRoot.presentation.statusColumnHidden,
    ),
  );
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 100 });
  const [pinnedColumns, setPinnedColumns] = useState<readonly string[]>(
    treeRoot.presentation.pinnedColumns ?? [],
  );

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
    const matchingIds = filterNodeItemIds(graph, treeRoot.id, allIds, viewFilters, freeText);
    const activeSort = sorting[0];
    const sortedIds = sortItemIds(snapshot, matchingIds, {
      ...sortForColumn(activeSort?.id ?? '$modified', activeSort?.desc === false ? 'asc' : 'desc'),
    });
    return sortedIds.flatMap((id) => {
      const item = snapshot.itemsById.get(id);
      return item ? [item] : [];
    });
  }, [freeText, graph, snapshot, sorting, treeRoot.id, viewFilters]);
  // The root collection's filters are the view filters.
  const filterControls = tableFilterControls({
    node: treeRoot,
    label: 'View filter',
    addLabel: 'Add view filter',
    subject: treeRoot.name,
    heading: 'View filters',
    loadedView,
    contentState,
    graph,
    itemIds: snapshot.items.map((item) => item.id),
    freeText,
    filters: viewFilters,
    onChange: (text, filters) => {
      persistPresentation({ freeText: text });
      applyViewFilters(filters);
    },
  });
  const hasManagerLink = reference.area !== 'other';
  const canExpand = treeRoot.children.length > 0;
  const actionColumnWidth = contentActionColumnWidth(canExpand, hasManagerLink);

  const columns = useMemo(
    () =>
      createContentTableColumns({
        definitions: itemColumnDefinitions,
        actionColumnWidth,
        renderValue: (value) => <CellValue value={value} />,
        renderStatus: (item) => (
          <PublicationStatusCell item={item} reference={{ ...reference, itemZuid: item.id }} />
        ),
      }),
    [actionColumnWidth, itemColumnDefinitions, reference],
  );

  const table = useContentTable({
    data: filteredItems,
    columns,
    sorting,
    columnSizing,
    columnVisibility,
    pagination,
    pinnedColumns,
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
        statusColumnHidden: next.$status === false,
      });
    },
    onPaginationChange: setPagination,
    onPinnedColumnsChange: (next) => {
      setPinnedColumns(next);
      persistPresentation({ pinnedColumns: next });
    },
  });

  function persistPresentation(patch: Partial<NodePresentation>) {
    onPresentationChange(treeRoot.id, { ...treeRoot.presentation, ...patch });
  }

  function applyViewFilters(next: readonly ViewFilter[]) {
    onViewFiltersChange(next);
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }

  function clearSearchAndFilters() {
    persistPresentation({ freeText: '' });
    applyViewFilters([]);
  }

  function updateNodeState(nodeId: CollectionNodeId, state: SharedNodeTableState) {
    setNodeStates((current) => {
      const next = new Map(current);
      next.set(nodeId, state);
      return next;
    });
  }

  return (
    <ScrollDockProvider pageHeader={pageHeader}>
      <section
        className={`relative overflow-visible ${panelClassName}`}
        aria-label={`${schema.label} collection`}
      >
        <div className={headerClassName}>
          <div className="min-w-36">
            <h2 className="m-0 text-[17px] font-bold tracking-[-0.02em]">{schema.label}</h2>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              {resultsPending
                ? `${snapshot.items.length} items`
                : `${filteredItems.length} of ${snapshot.items.length} items`}
            </span>
          </div>
          <div className="flex items-center gap-2 max-lg:w-full">
            {filterControls.toolbarButton}
            <ContentColumnsMenu
              table={table}
              columns={itemColumnDefinitions}
              label="Choose visible columns"
            />
          </div>
        </div>
        {filterControls.chipRow}
        {snapshot.partial ? (
          <p
            className="m-0 border-b border-warning-border bg-warning px-3.5 py-2 text-xs text-warning-foreground"
            role="status"
          >
            Showing a partial collection. Results may be incomplete.
          </p>
        ) : null}
        {snapshot.items.length === 0 ? (
          <p className="m-0 p-7 text-center text-sm text-muted-foreground">
            This collection has no content items.
          </p>
        ) : (
          <>
            {resultsPending ? <TableSkeleton label="Loading related results" rows={8} /> : null}
            {/* Hidden rather than unmounted while results wait, so expanded rows stay open. */}
            <div hidden={resultsPending}>
              <ContentTableGrid
                table={table}
                label={schema.label}
                reference={reference}
                canExpand={canExpand}
                onOpenDetails={onOpenDetails}
                emptyContent={
                  <div className="flex flex-col items-center gap-2 p-7 text-center text-sm text-muted-foreground">
                    <p className="m-0 font-medium text-foreground">
                      No items match your search or filters
                    </p>
                    {viewFilters.length > 0 || freeText !== '' ? (
                      <Button variant="outline" size="sm" onClick={clearSearchAndFilters}>
                        Clear search and filters
                      </Button>
                    ) : null}
                  </div>
                }
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
                        root={treeRoot}
                      />
                    ))}
                  </div>
                )}
              />
              <ContentTablePagination
                table={table}
                itemCount={filteredItems.length}
                itemLabel="items"
              />
            </div>
          </>
        )}
      </section>
    </ScrollDockProvider>
  );
}
