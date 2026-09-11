import { ChevronDown, ChevronRight, ExternalLink, PanelRightOpen } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import type {
  CollectionNode,
  CollectionNodeId,
  ContentItem,
  ContentState,
  ItemZuid,
  SortState,
  ViewFilter,
} from '../../domain';
import {
  filterNodeItemIds,
  pageItemIds,
  sortItemIds,
  type ExplorerGraph,
} from '../../explorer-core';
import { snapshotQueryKey, type SnapshotLoadState } from '../../zesty-api';
import type { LoadedView } from '../load-view';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

export interface SharedNodeTableState {
  readonly freeText: string;
  readonly filters: readonly ViewFilter[];
  readonly sort: SortState;
  readonly hiddenColumns: ReadonlySet<string>;
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
): SharedNodeTableState {
  return (
    states.get(node.id) ?? {
      freeText: node.presentation.freeText,
      filters: node.presentation.filters,
      sort: node.presentation.sort,
      hiddenColumns: new Set(),
    }
  );
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
    onOpenDetails,
    onPreview,
    onRetry,
  } = props;
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState<ReadonlySet<ItemZuid>>(new Set());
  const sharedState = stateFor(node, nodeStates);
  const deferredText = useDebouncedValue(sharedState.freeText);
  const state = snapshotState(node, loadedView, contentState);
  const schema = loadedView.schemas.get(node.id);
  const parentSchema = loadedView.schemas.get(parentNode.id);
  const parentField = node.relationship?.parentField[0];
  const childField = node.relationship?.kind === 'custom' ? node.relationship.childField[0] : 'id';
  const relationshipIsStale = Boolean(
    !node.relationship ||
    !parentField ||
    !childField ||
    (parentField !== 'id' && !parentSchema?.fields.some((field) => field.name === parentField)) ||
    (childField !== 'id' && !schema?.fields.some((field) => field.name === childField)),
  );

  const sortedIds = useMemo(() => {
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
  }, [
    deferredText.value,
    graph,
    node.id,
    parentItemId,
    sharedState.filters,
    sharedState.sort,
    state,
  ]);

  if (!state || state.status === 'pending' || state.status === 'stale') {
    return <div className="nested-state">Loading {node.name}…</div>;
  }
  if (state.status === 'failed' || !schema) {
    const message =
      state.status === 'failed'
        ? state.error.message
        : loadedView.schemaErrors.get(node.id)?.message;
    return (
      <div className="nested-state nested-state--error" role="alert">
        <span>
          {node.name}: {message ?? 'The collection schema could not load.'}
        </span>
        <button className="button button--quiet" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  const pageIds = pageItemIds(sortedIds, pageIndex, pageSize);
  const pageCount = Math.max(1, Math.ceil(sortedIds.length / pageSize));
  const visibleFields = schema.fields.filter((field) => !sharedState.hiddenColumns.has(field.name));

  return (
    <section className="nested-table" aria-label={`${node.name} related items`}>
      <div className="nested-toolbar">
        <strong>{node.name}</strong>
        <input
          type="search"
          aria-label={`Filter ${node.name}`}
          placeholder="Filter rows"
          value={sharedState.freeText}
          onChange={(event) =>
            updateNodeState(node.id, { ...sharedState, freeText: event.target.value })
          }
        />
        <span className="muted">{sharedState.filters.length} filters</span>
        <label className="compact-label">
          Sort
          <select
            value={sharedState.sort.fieldPath.join('.')}
            onChange={(event) =>
              updateNodeState(node.id, {
                ...sharedState,
                sort: { ...sharedState.sort, fieldPath: [event.target.value] },
              })
            }
          >
            <option value="modified">Modified</option>
            {schema.fields.map((field) => (
              <option key={field.id} value={field.name}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button button--quiet"
          onClick={() =>
            updateNodeState(node.id, {
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
          <table>
            <thead>
              <tr>
                <th className="sticky-cell">Actions</th>
                {visibleFields.map((field) => (
                  <th key={field.id}>{field.label}</th>
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
                      {visibleFields.map((field) => (
                        <td key={field.id}>
                          <CellValue
                            label={field.label}
                            value={item.fields[field.name]}
                            onPreview={onPreview}
                          />
                        </td>
                      ))}
                    </tr>
                    {isExpanded ? (
                      <tr className="nested-host-row">
                        <td colSpan={visibleFields.length + 1}>
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
          disabled={pageIndex === 0}
          onClick={() => setPageIndex((page) => page - 1)}
        >
          Previous
        </button>
        <span>
          Page {pageIndex + 1} of {pageCount}
        </span>
        <button
          className="button button--quiet"
          disabled={pageIndex + 1 >= pageCount}
          onClick={() => setPageIndex((page) => page + 1)}
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
