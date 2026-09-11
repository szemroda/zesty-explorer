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
import { Fragment, useMemo, useState } from 'react';
import type {
  CollectionNode,
  CollectionNodeId,
  CollectionReference,
  CollectionSchema,
  CollectionSnapshot,
  ContentItem,
  ContentState,
  ViewFilter,
} from '../../domain';
import { filterNodeItemIds, sortItemIds } from '../../explorer-core';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { buildLoadedViewGraph, type LoadedView } from '../load-view';
import { CellValue, NestedTable, type SharedNodeTableState } from './NestedTable';

interface RootTableProps {
  readonly schema: CollectionSchema;
  readonly snapshot: CollectionSnapshot;
  readonly reference: CollectionReference;
  readonly treeRoot: CollectionNode;
  readonly loadedView: LoadedView;
  readonly contentState: ContentState;
  readonly globalFreeText?: string;
  readonly onOpenDetails: (item: ContentItem, trigger: HTMLElement) => void;
  readonly onRetry: () => void;
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

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string')
    return value
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return `${value}`;
  if (typeof value === 'symbol') return value.description ?? 'Symbol';
  return '[Function]';
}

export function RootTable({
  schema,
  snapshot,
  reference,
  treeRoot,
  loadedView,
  contentState,
  globalFreeText = '',
  onOpenDetails,
  onRetry,
}: RootTableProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<ContentItem['id']>>(new Set());
  const [nodeStates, setNodeStates] = useState<ReadonlyMap<CollectionNodeId, SharedNodeTableState>>(
    new Map(),
  );
  const [preview, setPreview] = useState<{ readonly label: string; readonly value: string }>();
  const [tableFreeText, setTableFreeText] = useState('');
  const [filters, setFilters] = useState<ViewFilter[]>([]);
  const [filterField, setFilterField] = useState(schema.fields[0]?.name ?? '');
  const [filterOperator, setFilterOperator] = useState<ViewFilter['operator']>('contains');
  const [filterValue, setFilterValue] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'modified', desc: true }]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({
    modified: false,
  });
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 100 });
  const deferredTableText = useDebouncedValue(tableFreeText);
  const deferredGlobalText = useDebouncedValue(globalFreeText);

  const graph = useMemo(
    () => buildLoadedViewGraph(treeRoot, loadedView, contentState),
    [contentState, loadedView, treeRoot],
  );
  const filteredItems = useMemo(() => {
    const allIds = snapshot.items.map((item) => item.id);
    const viewIds = filterNodeItemIds(graph, treeRoot.id, allIds, [], deferredGlobalText.value);
    const tableIds = filterNodeItemIds(
      graph,
      treeRoot.id,
      viewIds,
      filters,
      deferredTableText.value,
    );
    const activeSort = sorting[0];
    const sortedIds = sortItemIds(snapshot, tableIds, {
      fieldPath: [activeSort?.id ?? 'modified'],
      direction: activeSort?.desc === false ? 'asc' : 'desc',
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
                aria-label={`Open details for ${displayValue(row.original.fields.title)}`}
                onClick={(event) => onOpenDetails(row.original, event.currentTarget)}
              >
                <PanelRightOpen size={15} />
              </button>
              <a
                className="icon-button"
                aria-label={`Open ${displayValue(row.original.fields.title)} in Zesty Manager`}
                href={`${reference.managerBaseUrl}/${reference.area}/${reference.modelZuid}/${row.original.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} />
              </a>
            </div>
          ),
        }),
        ...schema.fields.map((field) =>
          columnHelper.accessor((item) => item.fields[field.name], {
            id: field.name,
            header: field.label,
            size: 190,
            cell: ({ getValue }) => (
              <CellValue
                label={field.label}
                value={getValue()}
                onPreview={(label, value) => setPreview({ label, value })}
              />
            ),
          }),
        ),
        columnHelper.accessor((item) => item.metadata.modified, {
          id: 'modified',
          header: 'Modified',
          size: 180,
          cell: ({ getValue }) => (
            <CellValue
              label="Modified"
              value={getValue()}
              onPreview={(label, value) => setPreview({ label, value })}
            />
          ),
        }),
      ]),
    [expanded, onOpenDetails, reference, schema.fields, treeRoot.children.length],
  );

  const table = useTable({
    features,
    data: filteredItems,
    columns,
    state: { sorting, columnSizing, columnVisibility, pagination },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    manualSorting: true,
    defaultColumn: { size: 190, minSize: 90, maxSize: 520 },
    columnResizeMode: 'onChange',
  });

  function addFilter() {
    if (!filterField) return;
    setFilters((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        nodePath: [],
        fieldPath: [filterField],
        operator: filterOperator,
        ...(!['is-empty', 'is-not-empty', 'true', 'false'].includes(filterOperator)
          ? { value: filterValue }
          : {}),
      },
    ]);
    setFilterValue('');
    setPagination((current) => ({ ...current, pageIndex: 0 }));
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
                    {column.id}
                  </label>
                ))}
            </div>
          </details>
        </div>
      </div>
      <div className="filter-builder">
        <select
          aria-label="Filter field"
          value={filterField}
          onChange={(event) => setFilterField(event.target.value)}
        >
          {schema.fields.map((field) => (
            <option key={field.id} value={field.name}>
              {field.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter operator"
          value={filterOperator}
          onChange={(event) => setFilterOperator(event.target.value as ViewFilter['operator'])}
        >
          {[
            'contains',
            'equals',
            'starts-with',
            'not-equal',
            'greater-than',
            'less-than',
            'between',
            'is-empty',
            'is-not-empty',
            'true',
            'false',
          ].map((operator) => (
            <option key={operator} value={operator}>
              {operator.replaceAll('-', ' ')}
            </option>
          ))}
        </select>
        <input
          aria-label="Filter value"
          value={filterValue}
          disabled={['is-empty', 'is-not-empty', 'true', 'false'].includes(filterOperator)}
          onChange={(event) => setFilterValue(event.target.value)}
        />
        <button className="button button--quiet" onClick={addFilter}>
          Add filter
        </button>
        {filters.length > 0 ? (
          <button className="button button--quiet" onClick={() => setFilters([])}>
            Clear {filters.length}
          </button>
        ) : null}
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
