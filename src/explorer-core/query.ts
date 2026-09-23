import type {
  CollectionNodeId,
  CollectionSnapshot,
  ContentItem,
  FieldPath,
  ItemZuid,
  Scalar,
  SortState,
  ViewFilter,
} from '../domain';

export type ResolvedFieldValue =
  | { readonly kind: 'missing' }
  | { readonly kind: 'null' }
  | { readonly kind: 'scalar'; readonly value: Scalar }
  | { readonly kind: 'structured'; readonly value: object }
  | { readonly kind: 'invalid' };

export interface FilterCondition {
  readonly fieldPath: FieldPath;
  readonly operator: ViewFilter['operator'];
  readonly value?: unknown;
}

export interface ExplorerGraphInput {
  readonly rootNodeId: CollectionNodeId;
  readonly snapshots: ReadonlyMap<CollectionNodeId, CollectionSnapshot>;
  readonly childrenByNode: ReadonlyMap<CollectionNodeId, readonly CollectionNodeId[]>;
  readonly relationshipsByChildNode: ReadonlyMap<
    CollectionNodeId,
    ReadonlyMap<ItemZuid, readonly ItemZuid[]>
  >;
}

export interface ExplorerGraph {
  readonly rootNodeId: CollectionNodeId;
  snapshot(nodeId: CollectionNodeId): CollectionSnapshot;
  childNodeIds(nodeId: CollectionNodeId): readonly CollectionNodeId[];
  relatedItemIds(childNodeId: CollectionNodeId, parentItemId: ItemZuid): readonly ItemZuid[];
}

const missing: ResolvedFieldValue = { kind: 'missing' };
const invalid: ResolvedFieldValue = { kind: 'invalid' };

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function resolveFieldPath(item: ContentItem, path: FieldPath): ResolvedFieldValue {
  const [head, ...tail] = path;
  if (!head) return invalid;

  let value: unknown;
  if (head === 'id') value = item.id;
  else if (head === 'fields') value = item.fields;
  else if (head === 'metadata') value = item.metadata;
  else if (head === 'raw') value = item.raw;
  else if (hasOwn(item.fields, head)) value = item.fields[head];
  else if (hasOwn(item.metadata, head)) value = item.metadata[head];
  else return missing;

  for (const segment of tail) {
    if (value === null) return invalid;
    if (typeof value !== 'object' || Array.isArray(value)) return invalid;
    if (!hasOwn(value, segment)) return missing;
    value = (value as Readonly<Record<string, unknown>>)[segment];
  }

  if (value === undefined) return missing;
  if (value === null) return { kind: 'null' };
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { kind: 'scalar', value };
  }
  if (typeof value === 'object') return { kind: 'structured', value };
  return invalid;
}

export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedText(value: string): string {
  return stripHtml(value).toLocaleLowerCase('en-US');
}

function isEmpty(value: ResolvedFieldValue): boolean {
  return (
    value.kind === 'missing' ||
    value.kind === 'null' ||
    (value.kind === 'scalar' && typeof value.value === 'string' && value.value.trim() === '')
  );
}

function comparablePair(
  left: Scalar,
  right: unknown,
): [number | string, number | string] | undefined {
  if (typeof left === 'number' && typeof right === 'number') return [left, right];
  if (typeof left === 'string' && typeof right === 'string') return [left, right];
  return undefined;
}

export function matchesFilter(item: ContentItem, filter: FilterCondition): boolean {
  const resolved = resolveFieldPath(item, filter.fieldPath);
  if (filter.operator === 'is-empty') return isEmpty(resolved);
  if (filter.operator === 'is-not-empty') return !isEmpty(resolved);
  if (resolved.kind !== 'scalar') return false;

  const value = resolved.value;
  if (filter.operator === 'true') return value === true;
  if (filter.operator === 'false') return value === false;
  if (filter.operator === 'one-of') {
    return Array.isArray(filter.value) && filter.value.some((candidate) => candidate === value);
  }
  if (filter.operator === 'contains') {
    return typeof value === 'string' && typeof filter.value === 'string'
      ? normalizedText(value).includes(normalizedText(filter.value))
      : false;
  }
  if (filter.operator === 'starts-with') {
    return typeof value === 'string' && typeof filter.value === 'string'
      ? normalizedText(value).startsWith(normalizedText(filter.value))
      : false;
  }
  if (filter.operator === 'equals') {
    if (typeof value === 'string' && typeof filter.value === 'string') {
      return normalizedText(value) === normalizedText(filter.value);
    }
    return value === filter.value;
  }
  if (filter.operator === 'not-equal') return value !== filter.value;

  if (filter.operator === 'between') {
    if (!Array.isArray(filter.value) || filter.value.length !== 2) return false;
    const lower = comparablePair(value, filter.value[0]);
    const upper = comparablePair(value, filter.value[1]);
    return lower ? upper !== undefined && lower[0] >= lower[1] && upper[0] <= upper[1] : false;
  }

  const pair = comparablePair(value, filter.value);
  if (!pair) return false;
  if (filter.operator === 'greater-than') return pair[0] > pair[1];
  if (filter.operator === 'less-than') return pair[0] < pair[1];
  return false;
}

export function createExplorerGraph(input: ExplorerGraphInput): ExplorerGraph {
  return {
    rootNodeId: input.rootNodeId,
    snapshot: (nodeId) => {
      const snapshot = input.snapshots.get(nodeId);
      if (!snapshot) throw new Error(`Snapshot is missing for ${nodeId}.`);
      return snapshot;
    },
    childNodeIds: (nodeId) => input.childrenByNode.get(nodeId) ?? [],
    relatedItemIds: (childNodeId, parentItemId) =>
      input.relationshipsByChildNode.get(childNodeId)?.get(parentItemId) ?? [],
  };
}

function matchesPath(
  graph: ExplorerGraph,
  nodeId: CollectionNodeId,
  itemId: ItemZuid,
  nodePath: readonly CollectionNodeId[],
  filter: ViewFilter,
): boolean {
  if (nodePath.length === 0) {
    const item = graph.snapshot(nodeId).itemsById.get(itemId);
    return item ? matchesFilter(item, filter) : false;
  }
  const [childNodeId, ...rest] = nodePath;
  if (!childNodeId || !graph.childNodeIds(nodeId).includes(childNodeId)) return false;
  return graph
    .relatedItemIds(childNodeId, itemId)
    .some((childId) => matchesPath(graph, childNodeId, childId, rest, filter));
}

function scalarText(value: unknown): readonly string[] {
  if (typeof value === 'string') return [normalizedText(value)];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value).toLowerCase()];
  if (Array.isArray(value)) return value.flatMap(scalarText);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(scalarText);
  return [];
}

const searchableTextByItem = new WeakMap<ContentItem, readonly string[]>();

function itemContains(item: ContentItem, search: string): boolean {
  let values = searchableTextByItem.get(item);
  if (!values) {
    values = Object.values(item.fields).flatMap(scalarText);
    searchableTextByItem.set(item, values);
  }
  return values.some((value) => value.includes(search));
}

function graphContains(
  graph: ExplorerGraph,
  nodeId: CollectionNodeId,
  itemId: ItemZuid,
  search: string,
  memo: Map<CollectionNodeId, Map<ItemZuid, boolean>>,
): boolean {
  const nodeMemo = memo.get(nodeId) ?? new Map<ItemZuid, boolean>();
  if (!memo.has(nodeId)) memo.set(nodeId, nodeMemo);
  const cached = nodeMemo.get(itemId);
  if (cached !== undefined) return cached;

  const item = graph.snapshot(nodeId).itemsById.get(itemId);
  if (!item) {
    nodeMemo.set(itemId, false);
    return false;
  }
  if (itemContains(item, search)) {
    nodeMemo.set(itemId, true);
    return true;
  }
  const result = graph
    .childNodeIds(nodeId)
    .some((childNodeId) =>
      graph
        .relatedItemIds(childNodeId, itemId)
        .some((childId) => graphContains(graph, childNodeId, childId, search, memo)),
    );
  nodeMemo.set(itemId, result);
  return result;
}

export function filterNodeItemIds(
  graph: ExplorerGraph,
  nodeId: CollectionNodeId,
  itemIds: readonly ItemZuid[],
  filters: readonly ViewFilter[],
  freeText = '',
): readonly ItemZuid[] {
  const search = normalizedText(freeText);
  if (filters.length === 0 && !search) return itemIds;
  const searchMemo = new Map<CollectionNodeId, Map<ItemZuid, boolean>>();
  return itemIds.filter(
    (itemId) =>
      filters.every((filter) => matchesPath(graph, nodeId, itemId, filter.nodePath, filter)) &&
      (!search || graphContains(graph, nodeId, itemId, search, searchMemo)),
  );
}

function sortableValue(item: ContentItem | undefined, fieldPath: FieldPath): Scalar | undefined {
  if (!item) return undefined;
  const resolved = resolveFieldPath(item, fieldPath);
  if (resolved.kind !== 'scalar' || resolved.value === '') return undefined;
  return resolved.value;
}

function compareScalars(left: Scalar, right: Scalar): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  return String(left).localeCompare(String(right), 'en-US', { numeric: true, sensitivity: 'base' });
}

export function sortItemIds(
  snapshot: CollectionSnapshot,
  itemIds: readonly ItemZuid[],
  sort: SortState,
): readonly ItemZuid[] {
  return itemIds
    .map((id, index) => ({
      id,
      index,
      value: sortableValue(snapshot.itemsById.get(id), sort.fieldPath),
    }))
    .sort((left, right) => {
      if (left.value === undefined && right.value === undefined) return left.index - right.index;
      if (left.value === undefined) return 1;
      if (right.value === undefined) return -1;
      const comparison = compareScalars(left.value, right.value);
      return comparison === 0
        ? left.index - right.index
        : sort.direction === 'asc'
          ? comparison
          : -comparison;
    })
    .map(({ id }) => id);
}

export function facetValues(snapshot: CollectionSnapshot, path: FieldPath): readonly Scalar[] {
  const values = new Set<Scalar>();
  for (const item of snapshot.items) {
    const resolved = resolveFieldPath(item, path);
    if (resolved.kind === 'scalar') values.add(resolved.value);
  }
  return [...values].sort(compareScalars);
}

export function pageItemIds(
  itemIds: readonly ItemZuid[],
  pageIndex: number,
  pageSize: number,
): readonly ItemZuid[] {
  const safePage = Math.max(0, Math.floor(pageIndex));
  return itemIds.slice(safePage * pageSize, (safePage + 1) * pageSize);
}
