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
  ChevronUp,
  ExternalLink,
  PanelRightOpen,
  SlidersHorizontal,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  CollectionReference,
  CollectionSchema,
  CollectionSnapshot,
  ContentItem,
  ViewFilter,
} from '../../domain';
import { createExplorerGraph, filterNodeItemIds, sortItemIds } from '../../explorer-core';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

interface RootTableProps {
  readonly schema: CollectionSchema;
  readonly snapshot: CollectionSnapshot;
  readonly reference: CollectionReference;
  readonly globalFreeText?: string;
  readonly onOpenDetails: (item: ContentItem) => void;
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
  globalFreeText = '',
  onOpenDetails,
}: RootTableProps) {
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
    () =>
      createExplorerGraph({
        rootNodeId: 'node-root',
        snapshots: new Map([['node-root', snapshot]]),
        childrenByNode: new Map(),
        relationshipsByChildNode: new Map(),
      }),
    [snapshot],
  );
  const filteredItems = useMemo(() => {
    const allIds = snapshot.items.map((item) => item.id);
    const viewIds = filterNodeItemIds(graph, 'node-root', allIds, [], deferredGlobalText.value);
    const tableIds = filterNodeItemIds(
      graph,
      'node-root',
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
  }, [deferredGlobalText.value, deferredTableText.value, filters, graph, snapshot, sorting]);

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
              <button
                className="icon-button"
                aria-label={`Open details for ${displayValue(row.original.fields.title)}`}
                onClick={() => onOpenDetails(row.original)}
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
            cell: ({ getValue }) => <span className="cell-value">{displayValue(getValue())}</span>,
          }),
        ),
        columnHelper.accessor((item) => item.metadata.modified, {
          id: 'modified',
          header: 'Modified',
          size: 180,
          cell: ({ getValue }) => <span className="cell-value">{displayValue(getValue())}</span>,
        }),
      ]),
    [onOpenDetails, reference, schema.fields],
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
              <tr key={row.original.id}>
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
    </div>
  );
}
