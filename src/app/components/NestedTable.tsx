import {
  type ColumnSizingState,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import { ListFilter, Search } from 'lucide-react';
import { useState } from 'react';
import type {
  CollectionNode,
  CollectionNodeId,
  CollectionSchema,
  CollectionSnapshot,
  ContentItem,
  ContentState,
  ItemZuid,
  NodePresentation,
  SortState,
  ViewFilter,
} from '../../domain';
import {
  filterNodeItemIds,
  scalarFieldPaths,
  sortItemIds,
  validateRelationshipPaths,
  type ExplorerGraph,
} from '../../explorer-core';
import { snapshotQueryKey, type SnapshotLoadState } from '../../zesty-api';
import {
  contentActionColumnWidth,
  createContentTableColumns,
  useContentTable,
} from '../content-table-model';
import type { LoadedView } from '../load-view';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { describeExplorerError } from '../error-message';
import {
  columnIdForSort,
  contentItemColumns,
  hiddenColumnIds,
  sortForColumn,
  visibleColumnIds,
} from '../content-item-presentation';
import { CellValue } from './CellValue';
import { ContentColumnsMenu, ContentTableGrid, ContentTablePagination } from './ContentTable';
import { ErrorTechnicalDetails } from './ErrorTechnicalDetails';
import { FilterBuilder } from './FilterBuilder';
import { PublicationStatusCell } from './PublicationStatusCell';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Input } from './ui/input';

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

type ContentItemColumns = ReturnType<typeof contentItemColumns>;

const emptyColumns: ContentItemColumns = [];
const columnsWithoutSnapshot = new WeakMap<CollectionSchema, ContentItemColumns>();
const columnsBySnapshot = new WeakMap<
  CollectionSnapshot,
  WeakMap<CollectionSchema, ContentItemColumns>
>();
const pathsWithoutSnapshot = new WeakMap<CollectionSchema, readonly string[]>();
const pathsBySnapshot = new WeakMap<
  CollectionSnapshot,
  WeakMap<CollectionSchema, readonly string[]>
>();

function cachedContentItemColumns(
  schema: CollectionSchema,
  snapshot?: CollectionSnapshot,
): ContentItemColumns {
  if (!snapshot) {
    const cached = columnsWithoutSnapshot.get(schema);
    if (cached) return cached;
    const columns = contentItemColumns(schema, []);
    columnsWithoutSnapshot.set(schema, columns);
    return columns;
  }

  const bySchema = columnsBySnapshot.get(snapshot) ?? new WeakMap();
  const cached = bySchema.get(schema);
  if (cached) return cached;
  const columns = contentItemColumns(schema, snapshot.items);
  bySchema.set(schema, columns);
  columnsBySnapshot.set(snapshot, bySchema);
  return columns;
}

function cachedScalarFieldPaths(
  schema: CollectionSchema,
  snapshot?: CollectionSnapshot,
): readonly string[] {
  if (!snapshot) {
    const cached = pathsWithoutSnapshot.get(schema);
    if (cached) return cached;
    const paths = scalarFieldPaths(schema);
    pathsWithoutSnapshot.set(schema, paths);
    return paths;
  }

  const bySchema = pathsBySnapshot.get(snapshot) ?? new WeakMap();
  const cached = bySchema.get(schema);
  if (cached) return cached;
  const paths = scalarFieldPaths(schema, snapshot);
  bySchema.set(schema, paths);
  pathsBySnapshot.set(snapshot, bySchema);
  return paths;
}

interface SortedIdsInput {
  readonly state: SnapshotLoadState | undefined;
  readonly graph: ExplorerGraph;
  readonly nodeId: CollectionNodeId;
  readonly parentItemId: ItemZuid;
  readonly filters: readonly ViewFilter[];
  readonly freeText: string;
  readonly sort: SortState;
}

function createSortedIdsMemo() {
  let previousInput: SortedIdsInput | undefined;
  let previousResult: readonly ItemZuid[] = [];

  return (input: SortedIdsInput): readonly ItemZuid[] => {
    if (
      previousInput !== undefined &&
      previousInput.state === input.state &&
      previousInput.graph === input.graph &&
      previousInput.nodeId === input.nodeId &&
      previousInput.parentItemId === input.parentItemId &&
      previousInput.filters === input.filters &&
      previousInput.freeText === input.freeText &&
      previousInput.sort === input.sort
    ) {
      return previousResult;
    }

    previousInput = input;
    if (!input.state || (input.state.status !== 'complete' && input.state.status !== 'partial')) {
      previousResult = [];
      return previousResult;
    }

    const related = input.graph.relatedItemIds(input.nodeId, input.parentItemId);
    const filtered = filterNodeItemIds(
      input.graph,
      input.nodeId,
      related,
      input.filters,
      input.freeText,
    );
    previousResult = sortItemIds(input.state.snapshot, filtered, input.sort);
    return previousResult;
  };
}

function createItemsMemo() {
  let previousSnapshot: CollectionSnapshot | undefined;
  let previousIds: readonly ItemZuid[] | undefined;
  let previousResult: readonly ContentItem[] = [];

  return (
    snapshot: CollectionSnapshot | undefined,
    itemIds: readonly ItemZuid[],
  ): readonly ContentItem[] => {
    if (snapshot === previousSnapshot && itemIds === previousIds) return previousResult;

    previousSnapshot = snapshot;
    previousIds = itemIds;
    previousResult = itemIds.flatMap((itemId) => {
      const item = snapshot?.itemsById.get(itemId);
      return item ? [item] : [];
    });
    return previousResult;
  };
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
      hiddenColumns: hiddenColumnIds(
        columns,
        node.presentation.visibleColumns,
        node.presentation.statusColumnHidden,
      ),
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
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [deriveSortedIds] = useState(createSortedIdsMemo);
  const [deriveItems] = useState(createItemsMemo);
  const state = snapshotState(node, loadedView, contentState);
  const schema = loadedView.schemas.get(node.id);
  const parentSchema = loadedView.schemas.get(parentNode.id);
  const parentState = snapshotState(parentNode, loadedView, contentState);
  const parentSnapshot =
    parentState?.status === 'complete' || parentState?.status === 'partial'
      ? parentState.snapshot
      : undefined;
  const childSnapshot =
    state?.status === 'complete' || state?.status === 'partial' ? state.snapshot : undefined;
  const columns = schema ? cachedContentItemColumns(schema, childSnapshot) : emptyColumns;
  const sharedState = stateFor(node, nodeStates, columns);
  const deferredText = useDebouncedValue(sharedState.freeText);
  const relationshipIsStale = Boolean(
    !node.relationship ||
    !parentSchema ||
    !schema ||
    !validateRelationshipPaths(
      node.relationship,
      cachedScalarFieldPaths(parentSchema, parentSnapshot),
      cachedScalarFieldPaths(schema, childSnapshot),
    ).valid,
  );

  const sortedIds = deriveSortedIds({
    state,
    graph,
    nodeId: node.id,
    parentItemId,
    filters: sharedState.filters,
    freeText: deferredText.value,
    sort: sharedState.sort,
  });

  const items = deriveItems(childSnapshot, sortedIds);
  const hasManagerLink = node.reference.area !== 'other';
  const canExpand = node.children.length > 0;
  const actionColumnWidth = contentActionColumnWidth(canExpand, hasManagerLink);
  const tableColumns = createContentTableColumns({
    definitions: columns,
    actionColumnWidth,
    renderValue: (value) => <CellValue value={value} />,
    renderStatus: (item) => (
      <PublicationStatusCell item={item} reference={{ ...node.reference, itemZuid: item.id }} />
    ),
  });
  const sorting: SortingState = [
    {
      id: columnIdForSort(sharedState.sort),
      desc: sharedState.sort.direction === 'desc',
    },
  ];
  const columnSizing: ColumnSizingState = sharedState.columnWidths;
  const columnVisibility: ColumnVisibilityState = Object.fromEntries(
    columns.map((column) => [column.id, !sharedState.hiddenColumns.has(column.id)]),
  );
  const table = useContentTable({
    data: items,
    columns: tableColumns,
    sorting,
    columnSizing,
    columnVisibility,
    pagination,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      const active = next[0];
      if (!active) return;
      updateSharedState({
        ...sharedState,
        sort: sortForColumn(active.id, active.desc ? 'desc' : 'asc'),
      });
      setPagination((current) => ({ ...current, pageIndex: 0 }));
    },
    onColumnSizingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnSizing) : updater;
      updateSharedState({ ...sharedState, columnWidths: next });
    },
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnVisibility) : updater;
      updateSharedState({
        ...sharedState,
        hiddenColumns: new Set(
          columns.filter((column) => next[column.id] === false).map((column) => column.id),
        ),
      });
    },
    onPaginationChange: setPagination,
  });

  if (!state) {
    return <div className="m-0 p-4.5 text-xs text-muted-foreground">Loading {node.name}...</div>;
  }
  if (state.status === 'failed' || !schema) {
    const failure = state.status === 'failed' ? state.error : loadedView.schemaErrors.get(node.id);
    const message = failure ? describeExplorerError(failure, window.location.origin) : undefined;
    return (
      <div
        className="m-0 flex items-start justify-between gap-4 p-4.5 text-xs text-danger"
        role="alert"
      >
        <div className="min-w-0">
          <span>
            {node.name}: {message?.message ?? 'The collection schema could not load.'}{' '}
            {message?.recovery}
          </span>
          {failure ? <ErrorTechnicalDetails error={failure} /> : null}
        </div>
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  function updateSharedState(next: SharedNodeTableState) {
    updateNodeState(node.id, next);
    onPresentationChange(node.id, {
      freeText: next.freeText,
      filters: next.filters,
      sort: next.sort,
      visibleColumns: visibleColumnIds(
        columns,
        Object.fromEntries(
          columns.map((column) => [column.id, !next.hiddenColumns.has(column.id)]),
        ),
      ),
      statusColumnHidden: next.hiddenColumns.has('$status'),
      columnWidths: next.columnWidths,
    });
  }

  return (
    <section
      className="relative min-w-0 overflow-visible rounded-lg border border-divider-emphasis bg-surface-nested"
      aria-label={`${node.name} related items`}
    >
      <div className="flex min-h-14 items-center justify-between gap-4 rounded-t-lg border-b border-border bg-surface-control px-2.5 py-2 pl-3.5 max-lg:items-start max-lg:flex-col">
        <div className="min-w-28">
          <strong className="text-xs">{node.name}</strong>
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            {sortedIds.length} related items
          </span>
        </div>
        <div className="flex items-center gap-2 max-lg:w-full">
          <label className="flex h-9 w-42.5 min-w-36 items-center gap-2 rounded-lg border border-input bg-surface-control pl-3 text-muted-foreground transition-[border-color,box-shadow] focus-within:border-ring/70 focus-within:ring-3 focus-within:ring-ring/10">
            <Search
              className="text-foreground/70"
              size={14}
              strokeWidth={2.25}
              aria-hidden="true"
            />
            <Input
              className="h-8.5 min-h-0 min-w-0 border-0 bg-transparent px-0 pr-2.5 shadow-none focus-visible:border-0 focus-visible:ring-0"
              type="search"
              aria-label={`Filter ${node.name}`}
              placeholder="Search"
              value={sharedState.freeText}
              onChange={(event) => {
                updateSharedState({ ...sharedState, freeText: event.target.value });
                setPagination((current) => ({ ...current, pageIndex: 0 }));
              }}
            />
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" aria-label={`Configure ${node.name} filters`}>
                  <ListFilter size={14} /> Filters
                  {sharedState.filters.length > 0 ? (
                    <Badge>{sharedState.filters.length}</Badge>
                  ) : null}
                </Button>
              }
            />
            <DropdownMenuContent
              align="end"
              className="w-[min(760px,calc(100vw-2rem))] min-w-0 p-0 lg:w-[min(760px,calc(100vw-330px))]"
            >
              <FilterBuilder
                label={`${node.name} table filter`}
                root={node}
                schemas={loadedView.schemas}
                filters={sharedState.filters}
                onChange={(filters) => {
                  updateSharedState({ ...sharedState, filters });
                  setPagination((current) => ({ ...current, pageIndex: 0 }));
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <ContentColumnsMenu
            table={table}
            columns={columns}
            label={`Choose ${node.name} columns`}
          />
        </div>
      </div>
      {deferredText.showProgress ? (
        <div
          className="absolute top-14 right-3.5 z-4 rounded-b-md bg-divider-subtle px-2 py-1 text-[10px] text-muted-foreground"
          role="status"
        >
          Updating results...
        </div>
      ) : null}
      {state.status === 'partial' ? (
        <p
          className="m-0 border-b border-warning-border bg-warning px-3.5 py-2 text-xs text-warning-foreground"
          role="status"
        >
          Incomplete related results
        </p>
      ) : null}
      {relationshipIsStale ? (
        <p
          className="m-0 border-b border-stale-border bg-stale px-3.5 py-2 text-xs text-stale-foreground"
          role="status"
        >
          This relationship uses a field path that is no longer in the collection schema. Edit the
          relationship to repair it.
        </p>
      ) : null}
      <ContentTableGrid
        table={table}
        reference={node.reference}
        canExpand={canExpand}
        onOpenDetails={onOpenDetails}
        emptyContent={
          <p className="m-0 p-4.5 text-xs text-muted-foreground">No related items match.</p>
        }
        renderExpandedRow={(item) => (
          <div className="grid gap-2.5 border-l-3 border-accent/30 py-3 pr-3 pl-4.5">
            {node.children.map((child) => (
              <NestedTable
                key={child.id}
                {...props}
                node={child}
                parentNode={node}
                parentItemId={item.id}
              />
            ))}
          </div>
        )}
      />
      <ContentTablePagination table={table} itemCount={items.length} itemLabel="related items" />
    </section>
  );
}
