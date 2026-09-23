import {
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createPaginatedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnSizingState,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  ExternalLink,
  ListFilter,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
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
  columnIdForSort,
  columnWidthLimits,
  contentItemColumns,
  defaultContentColumnWidth,
  formatContentValue,
  initialColumnVisibility,
  sortForColumn,
  visibleColumnIds,
} from '../content-item-presentation';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { buildLoadedViewGraph, type LoadedView } from '../load-view';
import { CellValue } from './CellValue';
import { FilterBuilder } from './FilterBuilder';
import { NestedTable, type SharedNodeTableState } from './NestedTable';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { buttonVariants } from './ui/button-variants';
import { Checkbox } from './ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

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

function itemLabel(item: ContentItem): string {
  const label = formatContentValue(item.fields.title ?? item.fields.name);
  return label === '—' ? item.id : label;
}

const features = tableFeatures({
  columnSizingFeature,
  columnResizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
const columnHelper = createColumnHelper<typeof features, ContentItem>();
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
  const [expanded, setExpanded] = useState<ReadonlySet<ContentItem['id']>>(new Set());
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
  const actionColumnWidth =
    treeRoot.children.length > 0 ? (hasManagerLink ? 140 : 102) : hasManagerLink ? 94 : 56;

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.display({
          id: 'actions',
          header: '',
          size: actionColumnWidth,
          enableHiding: false,
          enableResizing: false,
          cell: ({ row }) => (
            <div className="flex w-max items-center gap-1.5" role="group" aria-label="Item actions">
              {treeRoot.children.length > 0 ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="relative mr-1.5 after:pointer-events-none after:absolute after:inset-y-1.5 after:-right-1.5 after:w-px after:bg-border"
                  aria-label={`${expanded.has(row.original.id) ? 'Collapse' : 'Expand'} relationships for ${row.original.id}`}
                  aria-expanded={expanded.has(row.original.id)}
                  title={
                    expanded.has(row.original.id) ? 'Hide related items' : 'Show related items'
                  }
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(row.original.id)) next.delete(row.original.id);
                      else next.add(row.original.id);
                      return next;
                    })
                  }
                >
                  {expanded.has(row.original.id) ? (
                    <ChevronDown size={15} />
                  ) : (
                    <ChevronRight size={15} />
                  )}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Open details for ${itemLabel(row.original)}`}
                title="Open item details"
                onClick={(event) => onOpenDetails(row.original, event.currentTarget)}
              >
                <Eye size={15} />
              </Button>
              {hasManagerLink ? (
                <a
                  className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
                  aria-label={`Open ${itemLabel(row.original)} in Zesty Manager`}
                  href={`${reference.managerBaseUrl}/${reference.area}/${reference.modelZuid}/${row.original.id}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open in Zesty Manager in a new tab"
                >
                  <ExternalLink size={15} />
                </a>
              ) : null}
            </div>
          ),
        }),
        ...itemColumnDefinitions.map((column) =>
          columnHelper.accessor((item) => column.read(item), {
            id: column.id,
            header: column.label,
            size: column.defaultWidth,
            enableSorting: column.sortable,
            cell: ({ getValue }) => <CellValue value={getValue()} />,
          }),
        ),
      ]),
    [
      actionColumnWidth,
      expanded,
      hasManagerLink,
      itemColumnDefinitions,
      onOpenDetails,
      reference,
      treeRoot.children.length,
    ],
  );

  const table = useTable({
    features,
    data: filteredItems,
    columns,
    state: { sorting, columnSizing, columnVisibility, pagination },
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
    manualSorting: true,
    enableSortingRemoval: false,
    defaultColumn: {
      size: defaultContentColumnWidth,
      minSize: columnWidthLimits.min,
      maxSize: columnWidthLimits.max,
    },
    columnResizeMode: 'onChange',
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
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" aria-label="Choose visible columns">
                  <SlidersHorizontal size={14} /> Columns
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-56 p-2">
              {table
                .getAllLeafColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <label
                    className="flex items-center gap-2 rounded-md p-1.5 text-xs hover:bg-surface-menu-hover"
                    key={column.id}
                  >
                    <Checkbox
                      checked={column.getIsVisible()}
                      onCheckedChange={(checked) => column.toggleVisibility(checked)}
                    />
                    {itemColumnDefinitions.find((definition) => definition.id === column.id)
                      ?.label ?? column.id}
                  </label>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
      <div className="w-full min-w-0 overflow-x-auto">
        <Table
          className="border-separate border-spacing-0 text-xs"
          style={{ width: `max(100%, ${table.getTotalSize()}px)`, tableLayout: 'fixed' }}
        >
          <colgroup>
            {table.getVisibleLeafColumns().map((column, index, visibleColumns) => (
              <col
                key={column.id}
                style={
                  index === visibleColumns.length - 1 ? undefined : { width: column.getSize() }
                }
              />
            ))}
          </colgroup>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow className="hover:bg-transparent" key={group.id}>
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={`relative h-9 max-w-[520px] border-b border-divider-subtle bg-surface-header px-3 py-2 text-left align-middle text-[11px] font-bold tracking-[0.045em] whitespace-nowrap text-foreground/75 uppercase ${
                      header.id === 'actions'
                        ? 'sticky left-0 z-4 bg-surface-header shadow-sticky'
                        : ''
                    }`}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <Button
                        variant="ghost"
                        className="h-auto gap-1.5 p-0 font-[inherit] text-inherit hover:bg-transparent hover:text-content-hover"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <table.FlexRender header={header} />
                        {header.column.getIsSorted() === 'asc' ? <ChevronUp size={13} /> : null}
                        {header.column.getIsSorted() === 'desc' ? <ChevronDown size={13} /> : null}
                      </Button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                    {header.column.getCanResize() ? (
                      <span
                        className="absolute inset-y-1.5 -right-0.5 w-1.5 cursor-col-resize rounded-full hover:bg-accent/50"
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                      />
                    ) : null}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="[&_tr:last-child_td]:border-b-0">
            {table.getRowModel().rows.map((row) => (
              <Fragment key={row.original.id}>
                <TableRow className="group hover:bg-transparent">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={`h-11 max-w-[520px] border-b border-divider-subtle px-3 py-2 align-middle whitespace-nowrap group-hover:bg-surface-hover ${
                        cell.column.id === 'actions'
                          ? 'sticky left-0 z-3 bg-panel px-2.5 shadow-sticky'
                          : ''
                      }`}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
                {expanded.has(row.original.id) ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      className="h-auto bg-surface-recessed p-0 hover:bg-surface-recessed"
                      colSpan={table.getVisibleLeafColumns().length}
                    >
                      <div className="grid gap-2.5 border-l-3 border-accent/30 py-3 pr-3 pl-4.5">
                        {treeRoot.children.map((child) => (
                          <NestedTable
                            key={child.id}
                            node={child}
                            parentNode={treeRoot}
                            parentItemId={row.original.id}
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
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex min-h-12 items-center justify-end gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <span className="mr-auto">{filteredItems.length} items</span>
        {table.getPageCount() > 1 ? (
          <>
            <Button
              variant="outline"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              Previous
            </Button>
            <span className="text-foreground/80">
              Page {pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
            <Button
              variant="outline"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              Next
            </Button>
          </>
        ) : null}
        <label className="flex items-center gap-2">
          Items
          <Select
            items={[25, 50, 100].map((size) => ({ label: String(size), value: String(size) }))}
            value={String(pagination.pageSize)}
            onValueChange={(size) => {
              if (size !== null) table.setPageSize(Number(size));
            }}
          >
            <SelectTrigger className="min-w-20" size="sm" aria-label="Items per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {[25, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
    </section>
  );
}
