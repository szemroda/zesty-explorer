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
  filterFields,
  isSearchFilter,
  searchFilter,
  withSearchField,
  type FilterFields,
} from '../filter-fields';
import { loadedSnapshot, type LoadedView } from '../load-view';
import { AddFilterButton, FilterChip, FilterChipRow, type FilterListContext } from './FilterEditor';

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
  readonly heading: string;
  /** Says at the top of the editor what these filters affect; omit where the heading says it. */
  readonly hint?: string;
  readonly loadedView: LoadedView;
  readonly contentState: ContentState;
  readonly graph: ExplorerGraph;
  /** The table's rows before its own filters; option counts cover these and their related items. */
  readonly itemIds: readonly ItemZuid[];
  readonly filters: readonly ViewFilter[];
  readonly search: TableSearch;
}

export interface TableFilterControls {
  /** Opens an empty filter editor from the table toolbar. */
  readonly toolbarButton: ReactNode;
  /** The search and every filter, as chips; null while there are none. */
  readonly chipRow: ReactNode;
}

/** The toolbar button and chip row of one table, both editing its search and `filters`. */
export function tableFilterControls(options: TableFilterOptions): TableFilterControls {
  const { node, label, subject, hint, loadedView, contentState, graph, itemIds, filters } = options;
  const { search } = options;
  // The editor and the chips see the search as the first filter; writes split it back out.
  const currentSearch = search.text.trim() ? searchFilter(search.text) : undefined;
  const context: FilterListContext = {
    label,
    subject,
    hint,
    fields: cachedFilterFields(node, loadedView.schemas),
    itemsFor: (field) => {
      const snapshot = loadedSnapshot(field.node, loadedView, contentState);
      if (!snapshot) return undefined;
      return relatedItemsAlong(graph, itemIds, field.nodePath).flatMap((id) => {
        const item = snapshot.itemsById.get(id);
        return item ? [item] : [];
      });
    },
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

  return {
    toolbarButton: <AddFilterButton {...context} addLabel={options.addLabel} />,
    chipRow:
      context.filters.length > 0 ? (
        <FilterChipRow heading={options.heading} onClearAll={() => context.onChange([])}>
          {context.filters.map((filter) => (
            <FilterChip key={filter.id} {...context} filter={filter} />
          ))}
        </FilterChipRow>
      ) : null,
  };
}
