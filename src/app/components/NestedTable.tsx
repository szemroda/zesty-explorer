import { ChevronDown, ChevronRight, ExternalLink, PanelRightOpen } from 'lucide-react';
import { Fragment, useState } from 'react';
import type {
  CollectionField,
  CollectionNode,
  CollectionNodeId,
  ContentItem,
  ContentState,
  ItemZuid,
  NodePresentation,
  SortState,
  ViewFilter,
} from '../../domain';
import {
  filterNodeItemIds,
  pageItemIds,
  scalarFieldPaths,
  sortItemIds,
  validateRelationshipPaths,
  type ExplorerGraph,
} from '../../explorer-core';
import { snapshotQueryKey, type SnapshotLoadState } from '../../zesty-api';
import type { LoadedView } from '../load-view';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { describeExplorerError } from '../error-message';
import { FilterBuilder } from './FilterBuilder';

export interface SharedNodeTableState {
  readonly freeText: string;
  readonly filters: readonly ViewFilter[];
  readonly sort: SortState;
  readonly hiddenColumns: ReadonlySet<string>;
  readonly columnWidths: Readonly<Record<string, number>>;
}

interface NestedTableProps {
  readonly node: CollectionNode;
  readonly parentNode: CollectionNode;
  readonly parentItemId: ItemZuid;
  readonly graph: ExplorerGraph;
  readonly loadedView: LoadedView;
  readonly contentState: ContentState;
  readonly nodeStates: ReadonlyMap<CollectionNodeId, SharedNodeTableState>;
  readonly updateNodeState: (nodeId: CollectionNodeId, state: SharedNodeTableState) => void;
  readonly onPresentationChange: (nodeId: CollectionNodeId, presentation: NodePresentation) => void;
  readonly onOpenDetails: (item: ContentItem, trigger: HTMLElement) => void;
  readonly onPreview: (label: string, value: string) => void;
  readonly onRetry: () => void;
}

function readableValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string')
    return value
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return `${value}`;
  return typeof value === 'symbol' ? (value.description ?? 'Symbol') : '[Function]';
}

function CellValue({
  label,
  value,
  onPreview,
}: {
  readonly label: string;
  readonly value: unknown;
  readonly onPreview: NestedTableProps['onPreview'];
}) {
  const text = readableValue(value);
  if (text.length < 56) return <span className="cell-value">{text}</span>;
  return (
    <button
      className="cell-preview-trigger"
      aria-label={`Preview full ${label}`}
      onMouseEnter={() => onPreview(label, text)}
      onFocus={() => onPreview(label, text)}
      onClick={() => onPreview(label, text)}
    >
      {text}
    </button>
  );
}

function stateFor(
  node: CollectionNode,
  states: ReadonlyMap<CollectionNodeId, SharedNodeTableState>,
  columns: readonly NestedColumn[],
): SharedNodeTableState {
  const saved = node.presentation.visibleColumns;
  const usesDefaults = saved.includes('*');
  return (
    states.get(node.id) ?? {
      freeText: node.presentation.freeText,
      filters: node.presentation.filters,
      sort: node.presentation.sort,
      hiddenColumns: new Set(
        columns
          .filter((column) => (usesDefaults ? column.technical : !saved.includes(column.id)))
          .map((column) => column.id),
      ),
      columnWidths: node.presentation.columnWidths,
    }
  );
}

interface NestedColumn {
  readonly id: string;
  readonly label: string;
  readonly technical: boolean;
  value(item: ContentItem): unknown;
}

function nestedColumns(fields: readonly CollectionField[]): readonly NestedColumn[] {
  return [
    ...fields.map((field) => ({
      id: field.name,
      label: field.label,
      technical: false,
      value: (item: ContentItem) => item.fields[field.name],
    })),
    { id: '$id', label: 'ZUID', technical: true, value: (item) => item.id },
    { id: '$created', label: 'Created', technical: true, value: (item) => item.metadata.created },
    {
      id: '$modified',
      label: 'Modified',
      technical: true,
      value: (item) => item.metadata.modified,
    },
    { id: '$version', label: 'Version', technical: true, value: (item) => item.metadata.version },
    { id: '$raw', label: 'Raw JSON', technical: true, value: (item) => item.raw },
  ];
}

function snapshotState(
  node: CollectionNode,
  loadedView: LoadedView,
  contentState: ContentState,
): SnapshotLoadState | undefined {
  return loadedView.snapshots.snapshots.get(snapshotQueryKey(node.reference, contentState));
}

export function NestedTable(props: NestedTableProps) {
  const {
    node,
    parentNode,
    parentItemId,
    graph,
    loadedView,
    contentState,
    nodeStates,
    updateNodeState,
    onPresentationChange,
    onOpenDetails,
    onPreview,
    onRetry,
  } = props;
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState<ReadonlySet<ItemZuid>>(new Set());
  const state = snapshotState(node, loadedView, contentState);
  const schema = loadedView.schemas.get(node.id);
  const columns = nestedColumns(schema?.fields ?? []);
  const sharedState = stateFor(node, nodeStates, columns);
  const deferredText = useDebouncedValue(sharedState.freeText);
  const parentSchema = loadedView.schemas.get(parentNode.id);
  const parentState = snapshotState(parentNode, loadedView, contentState);
  const parentSnapshot =
    parentState?.status === 'complete' || parentState?.status === 'partial'
      ? parentState.snapshot
      : undefined;
  const childSnapshot =
    state?.status === 'complete' || state?.status === 'partial' ? state.snapshot : undefined;
  const relationshipIsStale = Boolean(
    !node.relationship ||
    !parentSchema ||
    !schema ||
    !validateRelationshipPaths(
      node.relationship,
      parentSchema ? scalarFieldPaths(parentSchema, parentSnapshot) : [],
      schema ? scalarFieldPaths(schema, childSnapshot) : [],
    ).valid,
  );

  const sortedIds = (() => {
    if (!state || (state.status !== 'complete' && state.status !== 'partial')) return [];
    const related = graph.relatedItemIds(node.id, parentItemId);
    const filtered = filterNodeItemIds(
      graph,
      node.id,
      related,
      sharedState.filters,
      deferredText.value,
    );
    return sortItemIds(state.snapshot, filtered, sharedState.sort);
  })();

  if (!state || state.status === 'pending' || state.status === 'stale') {
    return <div className="nested-state">Loading {node.name}…</div>;
  }
  if (state.status === 'failed' || !schema) {
    const failure = state.status === 'failed' ? state.error : loadedView.schemaErrors.get(node.id);
    const message = failure ? describeExplorerError(failure) : undefined;
    return (
      <div className="nested-state nested-state--error" role="alert">
        <span>
          {node.name}: {message?.message ?? 'The collection schema could not load.'}{' '}
          {message?.recovery}
        </span>
        <button className="button button--quiet" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  const currentSchema = schema;
  const pageCount = Math.max(1, Math.ceil(sortedIds.length / pageSize));
  const currentPageIndex = Math.min(pageIndex, pageCount - 1);
  const pageIds = pageItemIds(sortedIds, currentPageIndex, pageSize);
  const visibleColumns = columns.filter((column) => !sharedState.hiddenColumns.has(column.id));

  function updateSharedState(next: SharedNodeTableState) {
    updateNodeState(node.id, next);
    onPresentationChange(node.id, {
      freeText: next.freeText,
      filters: next.filters,
      sort: next.sort,
      visibleColumns: columns
        .map((column) => column.id)
        .filter((id) => !next.hiddenColumns.has(id)),
      columnWidths: next.columnWidths,
    });
  }

  return (
    <section className="nested-table" aria-label={`${node.name} related items`}>
      <div className="nested-toolbar">
        <strong>{node.name}</strong>
        <input
          type="search"
          aria-label={`Filter ${node.name}`}
          placeholder="Filter rows"
          value={sharedState.freeText}
          onChange={(event) => updateSharedState({ ...sharedState, freeText: event.target.value })}
        />
        <span className="muted">{sharedState.filters.length} filters</span>
        <details className="columns-menu">
          <summary className="button button--quiet">Columns</summary>
          <div className="columns-menu__popup">
            {columns.map((column) => (
              <div className="nested-column-control" key={column.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!sharedState.hiddenColumns.has(column.id)}
                    onChange={(event) => {
                      const hiddenColumns = new Set(sharedState.hiddenColumns);
                      if (event.target.checked) hiddenColumns.delete(column.id);
                      else hiddenColumns.add(column.id);
                      updateSharedState({ ...sharedState, hiddenColumns });
                    }}
                  />
                  {column.label}
                </label>
                <input
                  type="number"
                  aria-label={`${column.label} column width`}
                  min="90"
                  max="520"
                  value={sharedState.columnWidths[column.id] ?? 190}
                  onChange={(event) => {
                    const width = Number(event.target.value);
                    if (!Number.isFinite(width) || width < 90 || width > 520) return;
                    updateSharedState({
                      ...sharedState,
                      columnWidths: {
                        ...sharedState.columnWidths,
                        [column.id]: width,
                      },
                    });
                  }}
                />
              </div>
            ))}
          </div>
        </details>
        <label className="compact-label">
          Sort
          <select
            value={sharedState.sort.fieldPath.join('.')}
            onChange={(event) =>
              updateSharedState({
                ...sharedState,
                sort: { ...sharedState.sort, fieldPath: event.target.value.split('.') },
              })
            }
          >
            <option value="modified">Modified</option>
            <option value="id">ZUID</option>
            <option value="created">Created</option>
            <option value="version">Version</option>
            {currentSchema.fields.map((field) => (
              <option key={field.id} value={field.name}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button button--quiet"
          onClick={() =>
            updateSharedState({
              ...sharedState,
              sort: {
                ...sharedState.sort,
                direction: sharedState.sort.direction === 'asc' ? 'desc' : 'asc',
              },
            })
          }
        >
          {sharedState.sort.direction === 'asc' ? 'Ascending' : 'Descending'}
        </button>
      </div>
      <FilterBuilder
        label={`${node.name} table filter`}
        root={node}
        schemas={loadedView.schemas}
        filters={sharedState.filters}
        onChange={(filters) => updateSharedState({ ...sharedState, filters })}
      />
      {state.status === 'partial' ? (
        <p className="partial-warning">Incomplete related results</p>
      ) : null}
      {relationshipIsStale ? (
        <p className="stale-warning" role="status">
          This relationship uses a field path that is no longer in the collection schema. Edit the
          relationship to repair it.
        </p>
      ) : null}
      {pageIds.length === 0 ? (
        <p className="nested-empty">No related items match.</p>
      ) : (
        <div className="table-scroll">
          <table
            style={{
              tableLayout: 'fixed',
              width:
                96 +
                visibleColumns.reduce(
                  (total, column) => total + (sharedState.columnWidths[column.id] ?? 190),
                  0,
                ),
            }}
          >
            <thead>
              <tr>
                <th className="sticky-cell">Actions</th>
                {visibleColumns.map((column) => (
                  <th key={column.id} style={{ width: sharedState.columnWidths[column.id] ?? 190 }}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageIds.map((itemId) => {
                const item = state.snapshot.itemsById.get(itemId);
                if (!item) return null;
                const isExpanded = expanded.has(itemId);
                return (
                  <Fragment key={itemId}>
                    <tr>
                      <td className="sticky-cell">
                        <div className="row-actions">
                          {node.children.length > 0 ? (
                            <button
                              className="icon-button"
                              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} relationships for ${itemId}`}
                              onClick={() =>
                                setExpanded((current) => {
                                  const next = new Set(current);
                                  if (next.has(itemId)) next.delete(itemId);
                                  else next.add(itemId);
                                  return next;
                                })
                              }
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          ) : null}
                          <button
                            className="icon-button"
                            aria-label={`Open details for ${itemId}`}
                            onClick={(event) => onOpenDetails(item, event.currentTarget)}
                          >
                            <PanelRightOpen size={14} />
                          </button>
                          <a
                            className="icon-button"
                            aria-label={`Open ${itemId} in Zesty Manager`}
                            href={`${node.reference.managerBaseUrl}/${node.reference.area}/${node.reference.modelZuid}/${item.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={14} />
                          </a>
                        </div>
                      </td>
                      {visibleColumns.map((column) => (
                        <td
                          key={column.id}
                          style={{ width: sharedState.columnWidths[column.id] ?? 190 }}
                        >
                          <CellValue
                            label={column.label}
                            value={column.value(item)}
                            onPreview={onPreview}
                          />
                        </td>
                      ))}
                    </tr>
                    {isExpanded ? (
                      <tr className="nested-host-row">
                        <td colSpan={visibleColumns.length + 1}>
                          <div className="nested-stack">
                            {node.children.map((child) => (
                              <NestedTable
                                key={child.id}
                                {...props}
                                node={child}
                                parentNode={node}
                                parentItemId={itemId}
                              />
                            ))}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="pagination">
        <span>{sortedIds.length} related items</span>
        <button
          className="button button--quiet"
          disabled={currentPageIndex === 0}
          onClick={() => setPageIndex(currentPageIndex - 1)}
        >
          Previous
        </button>
        <span>
          Page {currentPageIndex + 1} of {pageCount}
        </span>
        <button
          className="button button--quiet"
          disabled={currentPageIndex + 1 >= pageCount}
          onClick={() => setPageIndex(currentPageIndex + 1)}
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
              <option key={size}>{size}</option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

export { CellValue };
