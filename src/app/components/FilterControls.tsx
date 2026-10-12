import type { ReactNode } from 'react';
import type {
  CollectionNode,
  CollectionNodeId,
  CollectionSchema,
  ContentState,
  ItemZuid,
  ViewFilter,
} from '../../domain';
import { relatedItemsAlong, type ExplorerGraph } from '../../explorer-core';
import {
  describeFilter,
  editsField,
  filterFields,
  findFilterField,
  isSearchFilter,
  searchFilter,
  withFilter,
  withSearchField,
  type FilterField,
  type FilterFields,
} from '../filter-fields';
import { loadedSnapshot, type LoadedView } from '../load-view';
import type { FilterScope } from './ColumnFilterForm';
import type { ColumnFilterEditor } from './ColumnMenu';
import {
  AddFilterButton,
  FilterChip,
  FilterChipRow,
  type FilterContext,
  type FilterListContext,
} from './FilterEditor';

type Schemas = ReadonlyMap<CollectionNodeId, CollectionSchema>;

const fieldsBySchemas = new WeakMap<Schemas, WeakMap<CollectionNode, FilterFields>>();

// Every expanded row renders a table per child node, so each node's fields are built once.
function cachedFilterFields(node: CollectionNode, schemas: Schemas): FilterFields {
  const byNode = fieldsBySchemas.get(schemas) ?? new WeakMap<CollectionNode, FilterFields>();
  const cached = byNode.get(node);
  if (cached) return cached;
  const fields = withSearchField(filterFields(node, schemas), node);
  byNode.set(node, fields);
  fieldsBySchemas.set(schemas, byNode);
  return fields;
}

/**
 * Where a nested table sits in the view. Its column filters can go into the view filters, with
 * this `nodePath`, to keep only the root items that have a matching related item.
 */
export interface ViewScope {
  readonly root: CollectionNode;
  /** Node ids from the root's child down to this table's node. */
  readonly nodePath: readonly CollectionNodeId[];
  readonly filters: readonly ViewFilter[];
  readonly onChange: (filters: readonly ViewFilter[]) => void;
}

/** The table's free-text search, which the filter controls edit as the field "Any field". */
export interface TableSearch {
  readonly text: string;
  /** Sets the search and the filters together, so one update doesn't undo the other. */
  readonly onChange: (text: string, filters: readonly ViewFilter[]) => void;
}

export interface TableFilterOptions {
  readonly node: CollectionNode;
  /** Names the editor for assistive technology, e.g. `View filter`. */
  readonly label: string;
  /** Accessible name of the toolbar button, e.g. `Add view filter`. */
  readonly addLabel: string;
  /** The collection node whose rows the filters keep, used in the related-items hint. */
  readonly subject: string;
  /** Leads the chip row, e.g. `View filters`. */
  readonly heading?: string;
  readonly loadedView: LoadedView;
  readonly contentState: ContentState;
  readonly graph: ExplorerGraph;
  /** The table's rows before its own filters; option counts cover these and their related items. */
  readonly itemIds: readonly ItemZuid[];
  readonly filters: readonly ViewFilter[];
  readonly onChange: (filters: readonly ViewFilter[]) => void;
  readonly search: TableSearch;
  /** Whether the column's header is on screen; a filter that header shows needs no chip. */
  readonly isColumnShown: (columnId: string) => boolean;
  /** Set for nested tables only; the root table's filters already are view filters. */
  readonly viewScope?: ViewScope;
}

export interface TableFilterControls {
  /** Opens an empty filter editor from the table toolbar. */
  readonly toolbarButton: ReactNode;
  /** The search and the filters no column header on screen shows, as chips; null while none. */
  readonly chipRow: ReactNode;
  /** The filter a column's menu edits; undefined when the column is not one of the node's fields. */
  readonly columnFilter: (columnId: string) => ColumnFilterEditor | undefined;
}

/** One list a column can write its filter into. */
interface FilterList {
  readonly scope: FilterScope;
  readonly filters: readonly ViewFilter[];
  readonly onChange: (filters: readonly ViewFilter[]) => void;
  /** Where the list's column filters point: `[]` for the table's own, the node path for the view's. */
  readonly nodePath: readonly CollectionNodeId[];
}

function withoutFilter(filters: readonly ViewFilter[], id: string): readonly ViewFilter[] {
  return filters.filter((filter) => filter.id !== id);
}

function samePath(left: readonly CollectionNodeId[], right: readonly CollectionNodeId[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

// The table's own filters and, in nested tables, the view filters on this table's node.
function filterLists({ filters, onChange, viewScope }: TableFilterOptions): readonly FilterList[] {
  const table: FilterList = { scope: 'table', filters, onChange, nodePath: [] };
  if (!viewScope) return [table];
  const { filters: viewFilters, onChange: onViewChange, nodePath } = viewScope;
  return [table, { scope: 'view', filters: viewFilters, onChange: onViewChange, nodePath }];
}

interface ColumnFilter {
  readonly filter: ViewFilter;
  readonly list: FilterList;
}

// The first filter of `list` that the column editor of `field` can open.
function listFilter(list: FilterList, field: FilterField): ViewFilter | undefined {
  return list.filters.find(
    (candidate) =>
      samePath(candidate.nodePath, list.nodePath) &&
      editsField({ ...candidate, nodePath: [] }, field),
  );
}

// The filter a column header shows: table filters first.
function columnFilter(lists: readonly FilterList[], field: FilterField): ColumnFilter | undefined {
  for (const list of lists) {
    const filter = listFilter(list, field);
    if (filter) return { filter, list };
  }
  return undefined;
}

/** The toolbar button, chip row, and column menu filters of one table, all editing `filters`. */
export function tableFilterControls(options: TableFilterOptions): TableFilterControls {
  const { node, label, subject, loadedView, contentState, graph, itemIds, filters } = options;
  const { search, viewScope } = options;
  const fields = cachedFilterFields(node, loadedView.schemas);
  const context: FilterContext = {
    label,
    subject,
    fields,
    itemsFor: (field) => {
      const snapshot = loadedSnapshot(field.node, loadedView, contentState);
      if (!snapshot) return undefined;
      return relatedItemsAlong(graph, itemIds, field.nodePath).flatMap((id) => {
        const item = snapshot.itemsById.get(id);
        return item ? [item] : [];
      });
    },
  };
  const lists = filterLists(options);
  const scopeChoice = viewScope ? { root: viewScope.root.name, node: node.name } : undefined;

  // The toolbar editor and the chips see the search as the first filter; writes split it back out.
  const currentSearch = search.text.trim() ? searchFilter(search.text) : undefined;
  const listContext: FilterListContext = {
    ...context,
    filters: currentSearch ? [currentSearch, ...filters] : filters,
    onChange: (next) => {
      // A search added while one exists comes last and replaces it.
      const nextSearch = next.filter(isSearchFilter).at(-1);
      search.onChange(
        typeof nextSearch?.value === 'string' ? nextSearch.value : '',
        next.filter((filter) => !isSearchFilter(filter)),
      );
    },
  };

  // A filter needs a chip unless the header of its column is on screen and shows it. View filters
  // on related fields stay chips at the root, as they explain why root rows are missing.
  const chips = listContext.filters.filter((filter) => {
    const field = findFilterField(fields, filter);
    if (!field || !options.isColumnShown(field.field.name)) return true;
    return columnFilter(lists, field)?.filter.id !== filter.id;
  });
  const chipIds = new Set(chips.map((filter) => filter.id));

  return {
    toolbarButton: <AddFilterButton {...listContext} addLabel={options.addLabel} />,
    chipRow:
      chips.length > 0 ? (
        <FilterChipRow
          heading={options.heading}
          onClearAll={() =>
            listContext.onChange(listContext.filters.filter((filter) => !chipIds.has(filter.id)))
          }
        >
          {chips.map((filter) => (
            <FilterChip key={filter.id} {...listContext} filter={filter} />
          ))}
        </FilterChipRow>
      ) : null,
    columnFilter: (columnId) => {
      const field = findFilterField(fields, { nodePath: [], fieldPath: [columnId] });
      if (!field) return undefined;
      const found = columnFilter(lists, field);
      const removeFound = () => {
        if (found) found.list.onChange(withoutFilter(found.list.filters, found.filter.id));
      };
      return {
        label,
        field,
        current: found && {
          filter: found.filter,
          scope: found.list.scope,
          // The header already shows the label.
          summary: describeFilter({ ...found.filter, nodePath: [] }, fields).condition,
        },
        scopeChoice,
        itemsFor: context.itemsFor,
        apply: (filter, scope) => {
          const target = lists.find((list) => list.scope === scope);
          if (!target) return;
          if (found && found.list !== target) removeFound();
          // A filter moved into a list that already filters this column replaces that filter.
          const id = listFilter(target, field)?.id ?? filter.id;
          target.onChange(withFilter(target.filters, { ...filter, id, nodePath: target.nodePath }));
        },
        clear: removeFound,
      };
    },
  };
}
