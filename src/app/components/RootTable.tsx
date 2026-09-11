import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { ExternalLink, PanelRightOpen } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  CollectionReference,
  CollectionSchema,
  CollectionSnapshot,
  ContentItem,
} from '../../domain';

interface RootTableProps {
  readonly schema: CollectionSchema;
  readonly snapshot: CollectionSnapshot;
  readonly reference: CollectionReference;
  readonly onOpenDetails: (item: ContentItem) => void;
}

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, ContentItem>();

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string')
    return value
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }
  if (typeof value === 'symbol') return value.description ?? 'Symbol';
  return '[Function]';
}

function modified(item: ContentItem): string {
  const value = item.metadata.modified;
  return typeof value === 'string' ? value : '';
}

export function RootTable({ schema, snapshot, reference, onOpenDetails }: RootTableProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const sortedItems = useMemo(
    () => [...snapshot.items].sort((left, right) => modified(right).localeCompare(modified(left))),
    [snapshot],
  );
  const pageCount = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const pageItems = sortedItems.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.display({
          id: 'actions',
          header: '',
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
        ...schema.fields
          .filter((field) => field.kind !== 'relationship')
          .map((field) =>
            columnHelper.accessor((item) => item.fields[field.name], {
              id: field.name,
              header: field.label,
              cell: ({ getValue }) => (
                <span className="cell-value">{displayValue(getValue())}</span>
              ),
            }),
          ),
      ]),
    [onOpenDetails, reference, schema.fields],
  );

  const table = useTable({ features, data: pageItems, columns });

  if (snapshot.items.length === 0) {
    return <div className="state-card">This collection has no content items.</div>;
  }

  return (
    <div className="table-card">
      <div className="table-toolbar">
        <div>
          <p className="eyebrow">Root collection</p>
          <h2>{schema.label}</h2>
        </div>
        <span className="muted">Sorted by modified, newest first</span>
      </div>
      {snapshot.partial ? (
        <p className="partial-warning" role="status">
          Showing a partial collection. Results may be incomplete.
        </p>
      ) : null}
      <div className="table-scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    className={header.id === 'actions' ? 'sticky-cell' : undefined}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.original.id}>
                {row.getAllCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cell.column.id === 'actions' ? 'sticky-cell' : undefined}
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
        <button
          className="button button--quiet"
          disabled={pageIndex === 0}
          onClick={() => setPageIndex((page) => Math.max(0, page - 1))}
        >
          Previous
        </button>
        <span>
          Page {pageIndex + 1} of {pageCount}
        </span>
        <button
          className="button button--quiet"
          disabled={pageIndex + 1 >= pageCount}
          onClick={() => setPageIndex((page) => Math.min(pageCount - 1, page + 1))}
        >
          Next
        </button>
        <label>
          Rows
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPageIndex(0);
            }}
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
