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
  ExternalLink,
  PanelRightOpen,
  SlidersHorizontal,
} from 'lucide-react';
import { Popover } from '@base-ui/react/popover';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
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
  const [preview, setPreview] = useState<{ readonly label: string; readonly value: string }>();
  const setPreviewValue = useCallback(
    (label: string, value: string) => setPreview({ label, value }),
    [],
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

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.display({
          id: 'actions',
          header: '',
          enableHiding: false,
          enableResizing: false,
          cell: ({ row }) => (
            <div className="row-actions">
              {treeRoot.children.length > 0 ? (
                <button
                  className="icon-button"
                  aria-label={`${expanded.has(row.original.id) ? 'Collapse' : 'Expand'} relationships for ${row.original.id}`}
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
                </button>
              ) : null}
              <button
                className="icon-button"
                aria-label={`Open details for ${formatContentValue(row.original.fields.title)}`}
                onClick={(event) => onOpenDetails(row.original, event.currentTarget)}
              >
                <PanelRightOpen size={15} />
              </button>
              <a
                className="icon-button"
                aria-label={`Open ${formatContentValue(row.original.fields.title)} in Zesty Manager`}
                href={`${reference.managerBaseUrl}/${reference.area}/${reference.modelZuid}/${row.original.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} />
              </a>
            </div>
          ),
        }),
        ...itemColumnDefinitions.map((column) =>
          columnHelper.accessor((item) => column.read(item), {
            id: column.id,
            header: column.label,
            size: column.defaultWidth,
            enableSorting: column.sortable,
            cell: ({ getValue }) => (
              <CellValue label={column.label} value={getValue()} onPreview={setPreviewValue} />
            ),
          }),
        ),
      ]),
    [
      expanded,
      itemColumnDefinitions,
      onOpenDetails,
      reference,
      setPreviewValue,
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
    return <div className="state-card">This collection has no content items.</div>;

  return (
    <div className="table-card">
      <div className="table-toolbar">
        <div>
          <p className="eyebrow">Root collection</p>
          <h2>{schema.label}</h2>
        </div>
        <div className="table-tools">
          <input
            type="search"
            aria-label="Filter this table"
            placeholder="Filter this table"
            value={tableFreeText}
            onChange={(event) => setTableFreeText(event.target.value)}
          />
          <details className="columns-menu">
            <summary className="button button--quiet">
              <SlidersHorizontal size={14} /> Columns
            </summary>
            <div className="columns-menu__popup">
              {table
                .getAllLeafColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <label key={column.id}>
                    <input
                      type="checkbox"
                      checked={column.getIsVisible()}
                      onChange={column.getToggleVisibilityHandler()}
                    />
                    {itemColumnDefinitions.find((definition) => definition.id === column.id)
                      ?.label ?? column.id}
                  </label>
                ))}
            </div>
          </details>
        </div>
      </div>
      <div>
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
        {deferredTableText.showProgress || deferredGlobalText.showProgress ? (
          <span className="muted">Filtering…</span>
        ) : null}
      </div>
      {snapshot.partial ? (
        <p className="partial-warning" role="status">
          Showing a partial collection. Results may be incomplete.
        </p>
      ) : null}
      <div className="table-scroll">
        <table style={{ width: table.getTotalSize(), tableLayout: 'fixed' }}>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    className={header.id === 'actions' ? 'sticky-cell' : undefined}
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        className="sort-button"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <table.FlexRender header={header} />
                        {header.column.getIsSorted() === 'asc' ? <ChevronUp size={13} /> : null}
                        {header.column.getIsSorted() === 'desc' ? <ChevronDown size={13} /> : null}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                    {header.column.getCanResize() ? (
                      <span
                        className="column-resizer"
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                      />
                    ) : null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <Fragment key={row.original.id}>
                <tr>
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cell.column.id === 'actions' ? 'sticky-cell' : undefined}
                      style={{ width: cell.column.getSize() }}
                    >
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
                {expanded.has(row.original.id) ? (
                  <tr className="nested-host-row">
                    <td colSpan={table.getVisibleLeafColumns().length}>
                      <div className="nested-stack">
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
                            onPreview={(label, value) => setPreview({ label, value })}
                            onRetry={onRetry}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>{filteredItems.length} items</span>
        <button
          className="button button--quiet"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
        >
          Previous
        </button>
        <span>
          Page {pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>
        <button
          className="button button--quiet"
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
        >
          Next
        </button>
        <label>
          Rows
          <select
            value={pagination.pageSize}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Popover.Root open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(undefined)}>
        <Popover.Trigger className="preview-anchor" aria-hidden="true" tabIndex={-1}>
          Preview
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={8}>
            <Popover.Popup className="value-popover">
              <Popover.Title>{preview?.label}</Popover.Title>
              <pre>{preview?.value}</pre>
              <Popover.Close className="button button--quiet">Close</Popover.Close>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
