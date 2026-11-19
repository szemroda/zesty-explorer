import type { CollectionNode, ContentItem, ContentScope, ItemZuid } from '../domain';
import { filterNodeItemIds, sortItemIds, type ExplorerGraph } from '../explorer-core';
import {
  cellText,
  columnIdForSort,
  itemDisplayLabel,
  type ContentItemColumn,
  type ContentValueColumn,
} from './content-item-presentation';
import { loadedItemsById, loadedSnapshot, namedSortValue, type LoadedView } from './load-view';
import { richTextLines } from './rich-text';

export type ExportCell = string | number | null;

/** What an exported file holds: one header row and the rows beneath it. */
export interface ExportTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly ExportCell[])[];
}

/** The open view an export reads items and related items from. */
export interface ExportView {
  readonly graph: ExplorerGraph;
  readonly loadedView: LoadedView;
  readonly scope: ContentScope;
}

/** One exported row: an item, and the parent item it was reached from when the file names it. */
export interface ExportRow {
  readonly item: ContentItem;
  readonly parent?: ContentItem;
}

/** How a child collection is summed up in its parent's row: item names in one cell, or a count. */
export type RelatedSummary = 'names' | 'count';

export interface RelatedColumn {
  readonly node: CollectionNode;
  readonly summary: RelatedSummary;
}

export interface ExportRequest {
  readonly rows: readonly ExportRow[];
  readonly columns: readonly ContentValueColumn[];
  /** Adds the parent's ZUID and name before the item's own columns. */
  readonly parentNode?: CollectionNode;
  /** Child collections summed up after the item's own columns. */
  readonly related?: readonly RelatedColumn[];
}

/**
 * Columns a file can hold. Publication status is not part of the loaded items, and raw JSON does
 * not fit a cell.
 */
export function exportableColumns(
  columns: readonly ContentItemColumn[],
): readonly ContentValueColumn[] {
  return columns.filter(
    (column): column is ContentValueColumn => column.kind === 'value' && column.id !== '$raw',
  );
}

/** Builds the file's table. Cells read like the table shows them, with rich text as plain lines. */
export function exportTable(view: ExportView, request: ExportRequest): ExportTable {
  const { rows, columns, parentNode, related = [] } = request;
  const loadedItems = () => loadedItemsById(view.loadedView);
  return {
    headers: [
      ...(parentNode ? [`${parentNode.name} ZUID`, parentNode.name] : []),
      ...columns.map((column) => column.label),
      ...related.map(({ node, summary }) =>
        summary === 'count' ? `${node.name} count` : node.name,
      ),
    ],
    rows: rows.map(({ item, parent }) => [
      ...(parentNode ? [parent?.id ?? null, parent ? itemDisplayLabel(parent) : null] : []),
      ...columns.map((column) => exportCell(column, item, loadedItems)),
      ...related.map((column) => relatedSummary(view, column, item.id)),
    ]),
  };
}

function exportCell(
  column: ContentValueColumn,
  item: ContentItem,
  loadedItems: () => ReadonlyMap<string, ContentItem>,
): ExportCell {
  const value = column.read(item);
  if (value === null || value === undefined || value === '') return null;
  const shown = cellText(column, value, loadedItems);
  if (shown !== undefined) return shown;
  if (column.richText && typeof value === 'string') return richTextLines(value) || null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return JSON.stringify(value);
}

function relatedSummary(view: ExportView, { node, summary }: RelatedColumn, parentId: ItemZuid) {
  const items = relatedItems(view, node, parentId);
  if (summary === 'count') return items.length;
  return items.length === 0 ? null : items.map(itemDisplayLabel).join('; ');
}

/** A node's related items below one parent item, filtered and sorted like the node's tables. */
export function relatedItems(
  view: ExportView,
  node: CollectionNode,
  parentId: ItemZuid,
): readonly ContentItem[] {
  const snapshot = loadedSnapshot(node, view.loadedView, view.scope);
  if (!snapshot) return [];
  const { filters, freeText, sort } = node.presentation;
  const related = view.graph.relatedItemIds(node.id, parentId);
  const filtered = filterNodeItemIds(view.graph, node.id, related, filters, freeText);
  const sortField = columnIdForSort(sort);
  const sortsByName = view.loadedView.schemas
    .get(node.id)
    ?.fields.some((field) => field.name === sortField && field.kind === 'relationship');
  const sorted = sortItemIds(
    snapshot,
    filtered,
    sort,
    sortsByName ? namedSortValue(view.loadedView) : undefined,
  );
  return sorted.flatMap((id) => {
    const item = snapshot.itemsById.get(id);
    return item ? [item] : [];
  });
}

/**
 * The related items of the last node in `path` below every one of `rootItems`, each with its
 * parent, as the nested tables list them. `path` runs from the root node down to that node. An
 * item reached through several parents on the way down counts once.
 */
export function rowsUnderEveryParent(
  view: ExportView,
  path: readonly CollectionNode[],
  rootItems: readonly ContentItem[],
): readonly ExportRow[] {
  const node = path.at(-1);
  if (!node || path.length < 2) return [];
  let parents = rootItems;
  for (const step of path.slice(1, -1)) {
    const reached = new Map<ItemZuid, ContentItem>();
    for (const parent of parents) {
      for (const item of relatedItems(view, step, parent.id)) reached.set(item.id, item);
    }
    parents = [...reached.values()];
  }
  return parents.flatMap((parent) =>
    relatedItems(view, node, parent.id).map((item) => ({ item, parent })),
  );
}
