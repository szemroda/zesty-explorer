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
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { buttonVariants } from './ui/button-variants';
import { Checkbox } from './ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

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
  const [deriveSortedIds] = useState(createSortedIdsMemo);
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

  const currentSchema = schema;
  const pageCount = Math.max(1, Math.ceil(sortedIds.length / pageSize));
  const currentPageIndex = Math.min(pageIndex, pageCount - 1);
  const pageIds = pageItemIds(sortedIds, currentPageIndex, pageSize);
  const visibleColumns = columns.filter((column) => !sharedState.hiddenColumns.has(column.id));
  const hasManagerLink = node.reference.area !== 'other';
  const actionColumnWidth =
    node.children.length > 0 ? (hasManagerLink ? 140 : 102) : hasManagerLink ? 94 : 56;

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
    <section
      className="min-w-0 overflow-visible rounded-lg border border-divider-emphasis bg-surface-nested"
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
              onChange={(event) =>
                updateSharedState({ ...sharedState, freeText: event.target.value })
              }
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
                onChange={(filters) => updateSharedState({ ...sharedState, filters })}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" aria-label={`Choose ${node.name} columns`}>
                  <SlidersHorizontal size={14} /> Columns
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-64 p-2">
              {columns.map((column) => (
                <div className="grid grid-cols-[1fr_68px] items-center gap-2" key={column.id}>
                  <label className="flex items-center gap-2 rounded-md p-1.5 text-xs hover:bg-surface-menu-hover">
                    <Checkbox
                      checked={!sharedState.hiddenColumns.has(column.id)}
                      onCheckedChange={(checked) => {
                        const hiddenColumns = new Set(sharedState.hiddenColumns);
                        if (checked) hiddenColumns.delete(column.id);
                        else hiddenColumns.add(column.id);
                        updateSharedState({ ...sharedState, hiddenColumns });
                      }}
                    />
                    {column.label}
                  </label>
                  <Input
                    className="h-7.5 min-h-7.5 w-17 px-2 py-1"
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
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex items-stretch" role="group" aria-label={`Sort ${node.name}`}>
            <Select
              items={[
                { label: 'Modified', value: '$modified' },
                { label: 'ZUID', value: '$id' },
                { label: 'Created', value: '$created' },
                { label: 'Version', value: '$version' },
                ...columns
                  .filter((column) => column.id.startsWith('$meta.'))
                  .map((column) => ({ label: column.label, value: column.id })),
                ...currentSchema.fields.map((field) => ({
                  label: field.label,
                  value: field.name,
                })),
              ]}
              value={columnIdForSort(sharedState.sort)}
              onValueChange={(columnId) => {
                if (columnId === null) return;
                updateSharedState({
                  ...sharedState,
                  sort: sortForColumn(columnId, sharedState.sort.direction),
                });
              }}
            >
              <SelectTrigger className="w-44 rounded-r-none" size="sm" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="$modified">Modified</SelectItem>
                <SelectItem value="$id">ZUID</SelectItem>
                <SelectItem value="$created">Created</SelectItem>
                <SelectItem value="$version">Version</SelectItem>
                {columns
                  .filter((column) => column.id.startsWith('$meta.'))
                  .map((column) => (
                    <SelectItem key={column.id} value={column.id}>
                      {column.label}
                    </SelectItem>
                  ))}
                {currentSchema.fields.map((field) => (
                  <SelectItem key={field.id} value={field.name}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon-sm"
              className="rounded-l-none border-l-0"
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
            </Button>
          </div>
        </div>
      </div>
      {state.status === 'partial' ? (
        <p className="m-0 border-b border-warning-border bg-warning px-3.5 py-2 text-xs text-warning-foreground">
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
      {pageIds.length === 0 ? (
        <p className="m-0 p-4.5 text-xs text-muted-foreground">No related items match.</p>
      ) : (
        <div className="w-full min-w-0 overflow-x-auto">
          <Table
            className="border-separate border-spacing-0 text-xs"
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
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 z-4 h-9 max-w-[520px] border-b border-divider-subtle bg-surface-header px-3 py-2 text-left align-middle text-[11px] font-bold tracking-[0.045em] whitespace-nowrap text-foreground/75 uppercase shadow-sticky">
                  <span className="sr-only">Item actions</span>
                </TableHead>
                {visibleColumns.map((column) => (
                  <TableHead
                    className="relative h-9 max-w-[520px] border-b border-divider-subtle bg-surface-header px-3 py-2 text-left align-middle text-[11px] font-bold tracking-[0.045em] whitespace-nowrap text-foreground/75 uppercase"
                    key={column.id}
                  >
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child_td]:border-b-0">
              {pageIds.map((itemId) => {
                const item = state.snapshot.itemsById.get(itemId);
                if (!item) return null;
                const isExpanded = expanded.has(itemId);
                return (
                  <Fragment key={itemId}>
                    <TableRow className="group hover:bg-transparent">
                      <TableCell className="sticky left-0 z-3 h-11 max-w-[520px] border-b border-divider-subtle bg-panel px-2.5 py-2 align-middle whitespace-nowrap shadow-sticky group-hover:bg-surface-hover">
                        <div
                          className="flex w-max items-center gap-1.5"
                          role="group"
                          aria-label="Item actions"
                        >
                          {node.children.length > 0 ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="relative mr-1.5 after:pointer-events-none after:absolute after:inset-y-1.5 after:-right-1.5 after:w-px after:bg-border"
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
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Open details for ${itemId}`}
                            title="Open item details"
                            onClick={(event) => onOpenDetails(item, event.currentTarget)}
                          >
                            <Eye size={14} />
                          </Button>
                          {hasManagerLink ? (
                            <a
                              className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
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
                      </TableCell>
                      {visibleColumns.map((column) => (
                        <TableCell
                          className="h-11 max-w-[520px] border-b border-divider-subtle px-3 py-2 align-middle whitespace-nowrap group-hover:bg-surface-hover"
                          key={column.id}
                          style={{ width: columnWidth(column, sharedState.columnWidths) }}
                        >
                          <CellValue value={column.read(item)} />
                        </TableCell>
                      ))}
                    </TableRow>
                    {isExpanded ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          className="h-auto bg-surface-recessed p-0 hover:bg-surface-recessed"
                          colSpan={visibleColumns.length + 1}
                        >
                          <div className="grid gap-2.5 border-l-3 border-accent/30 py-3 pr-3 pl-4.5">
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
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex min-h-12 items-center justify-end gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <span className="mr-auto">{sortedIds.length} related items</span>
        {pageCount > 1 ? (
          <>
            <Button
              variant="outline"
              disabled={currentPageIndex === 0}
              onClick={() => setPageIndex(currentPageIndex - 1)}
            >
              Previous
            </Button>
            <span className="text-foreground/80">
              Page {currentPageIndex + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              disabled={currentPageIndex + 1 >= pageCount}
              onClick={() => setPageIndex(currentPageIndex + 1)}
            >
              Next
            </Button>
          </>
        ) : null}
        <label className="flex items-center gap-2">
          Items
          <Select
            items={[25, 50, 100].map((size) => ({ label: String(size), value: String(size) }))}
            value={String(pageSize)}
            onValueChange={(size) => {
              if (size === null) return;
              setPageSize(Number(size));
              setPageIndex(0);
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
