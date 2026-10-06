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
import { filterFields, findFilterField, type FilterFields } from '../filter-fields';
import { loadedSnapshot, type LoadedView } from '../load-view';
import {
  AddFilterButton,
  ColumnFilterButton,
  FilterChip,
  FilterChipRow,
  type FilterListContext,
} from './FilterEditor';

type Schemas = ReadonlyMap<CollectionNodeId, CollectionSchema>;

const fieldsBySchemas = new WeakMap<Schemas, WeakMap<CollectionNode, FilterFields>>();

// Every expanded row renders a table per child node, so each node's fields are built once.
function cachedFilterFields(node: CollectionNode, schemas: Schemas): FilterFields {
  const byNode = fieldsBySchemas.get(schemas) ?? new WeakMap<CollectionNode, FilterFields>();
  const cached = byNode.get(node);
  if (cached) return cached;
  const fields = filterFields(node, schemas);
  byNode.set(node, fields);
  fieldsBySchemas.set(schemas, byNode);
  return fields;
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
}

export interface TableFilterControls {
  /** Opens an empty filter editor from the table toolbar. */
  readonly toolbarButton: ReactNode;
  /** The active filters as chips; null while there are none. */
  readonly chipRow: ReactNode;
  /** The funnel for a column header; null when the column is not one of the node's fields. */
  readonly columnControl: (columnId: string) => ReactNode;
}

/** The toolbar button, chip row, and column funnels of one table, all editing `filters`. */
export function tableFilterControls({
  node,
  label,
  addLabel,
  subject,
  heading,
  loadedView,
  contentState,
  graph,
  itemIds,
  filters,
  onChange,
}: TableFilterOptions): TableFilterControls {
  const context: FilterListContext = {
    label,
    subject,
    fields: cachedFilterFields(node, loadedView.schemas),
    itemsFor: (field) => {
      const snapshot = loadedSnapshot(field.node, loadedView, contentState);
      if (!snapshot) return undefined;
      return relatedItemsAlong(graph, itemIds, field.nodePath).flatMap((id) => {
        const item = snapshot.itemsById.get(id);
        return item ? [item] : [];
      });
    },
    filters,
    onChange,
  };
  return {
    toolbarButton: <AddFilterButton {...context} addLabel={addLabel} />,
    chipRow:
      filters.length > 0 ? (
        <FilterChipRow heading={heading} onClearAll={() => onChange([])}>
          {filters.map((filter) => (
            <FilterChip key={filter.id} {...context} filter={filter} />
          ))}
        </FilterChipRow>
      ) : null,
    columnControl: (columnId) => {
      const field = findFilterField(context.fields, { nodePath: [], fieldPath: [columnId] });
      return field ? <ColumnFilterButton {...context} field={field} /> : null;
    },
  };
}
