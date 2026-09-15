import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  ExternalLink,
  ListFilter,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { Fragment, useState } from 'react';
import type {
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
import {
  columnIdForSort,
  columnWidth,
  columnWidthLimits,
  contentItemColumns,
  hiddenColumnIds,
  sortForColumn,
  withColumnWidth,
} from '../content-item-presentation';
import { CellValue } from './CellValue';
import { ErrorTechnicalDetails } from './ErrorTechnicalDetails';
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
  readonly onRetry: () => void;
}

function stateFor(
  node: CollectionNode,
  states: ReadonlyMap<CollectionNodeId, SharedNodeTableState>,
  columns: ReturnType<typeof contentItemColumns>,
): SharedNodeTableState {
  return (
    states.get(node.id) ?? {
      freeText: node.presentation.freeText,
      filters: node.presentation.filters,
      sort: node.presentation.sort,
      hiddenColumns: hiddenColumnIds(columns, node.presentation.visibleColumns),
      columnWidths: node.presentation.columnWidths,
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
    onPresentationChange,
    onOpenDetails,
    onRetry,
  } = props;
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState<ReadonlySet<ItemZuid>>(new Set());
  const state = snapshotState(node, loadedView, contentState);
  const schema = loadedView.schemas.get(node.id);
  const loadedItems =
    state?.status === 'complete' || state?.status === 'partial' ? state.snapshot.items : [];
  const columns = contentItemColumns({ fields: schema?.fields ?? [] }, loadedItems);
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

  if (!state) {
    return <div className="nested-state">Loading {node.name}…</div>;
  }
  if (state.status === 'failed' || !schema) {
    const failure = state.status === 'failed' ? state.error : loadedView.schemaErrors.get(node.id);
    const message = failure ? describeExplorerError(failure, window.location.origin) : undefined;
    return (
      <div className="nested-state nested-state--error" role="alert">
        <div className="nested-state__message">
          <span>
            {node.name}: {message?.message ?? 'The collection schema could not load.'}{' '}
            {message?.recovery}
          </span>
          {failure ? <ErrorTechnicalDetails error={failure} /> : null}
        </div>
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
  const actionColumnWidth = node.children.length > 0 ? 116 : 78;

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
        <div className="nested-title">
          <strong>{node.name}</strong>
          <span>{sortedIds.length} linked items</span>
        </div>
        <div className="nested-tools">
          <label className="search-control search-control--compact">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              aria-label={`Filter ${node.name}`}
              placeholder="Search"
              value={sharedState.freeText}
              onChange={(event) =>
                updateSharedState({ ...sharedState, freeText: event.target.value })
              }
            />
          </label>
          <details className="toolbar-menu">
            <summary className="button button--quiet" aria-label={`Configure ${node.name} filters`}>
              <ListFilter size={14} /> Filters
              {sharedState.filters.length > 0 ? (
                <span className="control-count">{sharedState.filters.length}</span>
              ) : null}
            </summary>
            <div className="toolbar-menu__popup toolbar-menu__popup--wide">
              <FilterBuilder
                label={`${node.name} table filter`}
                root={node}
                schemas={loadedView.schemas}
                filters={sharedState.filters}
                onChange={(filters) => updateSharedState({ ...sharedState, filters })}
              />
            </div>
          </details>
          <details className="toolbar-menu">
            <summary className="button button--quiet" aria-label={`Choose ${node.name} columns`}>
              <SlidersHorizontal size={14} /> Columns
            </summary>
            <div className="toolbar-menu__popup columns-menu__popup">
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
                    min={columnWidthLimits.min}
                    max={columnWidthLimits.max}
                    value={columnWidth(column, sharedState.columnWidths)}
                    onChange={(event) => {
                      const columnWidths = withColumnWidth(
                        sharedState.columnWidths,
                        column.id,
                        event.target.value,
                      );
                      if (!columnWidths) return;
                      updateSharedState({
                        ...sharedState,
                        columnWidths,
                      });
                    }}
                  />
                </div>
              ))}
            </div>
          </details>
          <div className="sort-control" role="group" aria-label={`Sort ${node.name}`}>
            <select
              aria-label="Sort"
              value={columnIdForSort(sharedState.sort)}
              onChange={(event) =>
                updateSharedState({
                  ...sharedState,
                  sort: sortForColumn(event.target.value, sharedState.sort.direction),
                })
              }
            >
              <option value="$modified">Modified</option>
              <option value="$id">ZUID</option>
              <option value="$created">Created</option>
              <option value="$version">Version</option>
              {columns
                .filter((column) => column.id.startsWith('$meta.'))
                .map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.label}
                  </option>
                ))}
              {currentSchema.fields.map((field) => (
                <option key={field.id} value={field.name}>
                  {field.label}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              aria-label={
                sharedState.sort.direction === 'asc' ? 'Sort ascending' : 'Sort descending'
              }
              aria-pressed={sharedState.sort.direction === 'desc'}
              title={sharedState.sort.direction === 'asc' ? 'Ascending' : 'Descending'}
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
              {sharedState.sort.direction === 'asc' ? (
                <ArrowUp size={14} />
              ) : (
                <ArrowDown size={14} />
              )}
            </button>
          </div>
        </div>
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
          <table
            style={{
              tableLayout: 'fixed',
              width: `max(100%, ${
                actionColumnWidth +
                visibleColumns.reduce(
                  (total, column) => total + columnWidth(column, sharedState.columnWidths),
                  0,
                )
              }px)`,
            }}
          >
            <colgroup>
              <col style={{ width: actionColumnWidth }} />
              {visibleColumns.map((column, index) => (
                <col
                  key={column.id}
                  style={
                    index === visibleColumns.length - 1
                      ? undefined
                      : { width: columnWidth(column, sharedState.columnWidths) }
                  }
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky-cell">
                  <span className="sr-only">Item actions</span>
                </th>
                {visibleColumns.map((column) => (
                  <th key={column.id}>{column.label}</th>
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
                        <div className="row-actions" role="group" aria-label="Item actions">
                          {node.children.length > 0 ? (
                            <button
                              className="button button--row button--relationship"
                              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} relationships for ${itemId}`}
                              aria-expanded={isExpanded}
                              title={isExpanded ? 'Hide related items' : 'Show related items'}
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
                            className="button button--row"
                            aria-label={`Open details for ${itemId}`}
                            title="Open item details"
                            onClick={(event) => onOpenDetails(item, event.currentTarget)}
                          >
                            <Eye size={14} />
                          </button>
                          {node.reference.area !== 'other' ? (
                            <a
                              className="button button--row"
                              aria-label={`Open ${itemId} in Zesty Manager`}
                              href={`${node.reference.managerBaseUrl}/${node.reference.area}/${node.reference.modelZuid}/${item.id}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Open in Zesty Manager in a new tab"
                            >
                              <ExternalLink size={14} />
                            </a>
                          ) : null}
                        </div>
                      </td>
                      {visibleColumns.map((column) => (
                        <td
                          key={column.id}
                          style={{ width: columnWidth(column, sharedState.columnWidths) }}
                        >
                          <CellValue value={column.read(item)} />
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
        {pageCount > 1 ? (
          <>
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
          </>
        ) : null}
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
