import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useId, useMemo } from 'react';
import type { CollectionCatalogEntry, CollectionCatalogGroup, ModelZuid } from '../../domain';
import { Combobox } from './ui/combobox';

interface PickerGroup {
  readonly value: string;
  readonly items: readonly CollectionCatalogEntry[];
}

interface CollectionPickerProps {
  readonly label: string;
  readonly collections: readonly CollectionCatalogEntry[];
  readonly value: ModelZuid | undefined;
  readonly onChange: (collection: CollectionCatalogEntry | undefined) => void;
  readonly disabled?: boolean;
}

const groupLabels: Readonly<Record<CollectionCatalogGroup, string>> = {
  content: 'Content',
  blocks: 'Blocks',
  other: 'Other',
};

const groupOrder: readonly CollectionCatalogGroup[] = ['content', 'blocks', 'other'];

export function CollectionPicker({
  label,
  collections,
  value,
  onChange,
  disabled = false,
}: CollectionPickerProps) {
  const id = useId();
  const selected = collections.find((collection) => collection.reference.modelZuid === value);
  const groups = useMemo(
    () =>
      groupOrder.flatMap((group): readonly PickerGroup[] => {
        const items = collections
          .filter((collection) => collection.group === group)
          .toSorted((left, right) => left.label.localeCompare(right.label));
        return items.length > 0 ? [{ value: groupLabels[group], items }] : [];
      }),
    [collections],
  );

  return (
    <Combobox.Root
      key={`${value ?? 'empty'}:${selected?.label ?? ''}`}
      items={groups}
      value={selected ?? null}
      onValueChange={(collection) => onChange(collection ?? undefined)}
      itemToStringLabel={(collection) => collection.label}
      isItemEqualToValue={(left, right) => left.reference.modelZuid === right.reference.modelZuid}
      filter={(collection, query) => {
        const searchable = [collection.label, collection.name, collection.reference.modelZuid].join(
          ' ',
        );
        return searchable.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
      }}
      disabled={disabled}
    >
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <Combobox.InputGroup className="collection-picker__input-group">
        <Combobox.Input id={id} placeholder="Search collections" />
        <div className="collection-picker__input-actions">
          <Combobox.Clear className="collection-picker__input-action" aria-label="Clear selection">
            <X size={14} />
          </Combobox.Clear>
          <Combobox.Trigger
            className="collection-picker__input-action"
            aria-label="Show collections"
          >
            <ChevronsUpDown size={14} />
          </Combobox.Trigger>
        </div>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner className="collection-picker__positioner" sideOffset={5}>
          <Combobox.Popup className="collection-picker__popup">
            <Combobox.Empty className="collection-picker__empty">
              No collections found.
            </Combobox.Empty>
            <Combobox.List className="collection-picker__list">
              {(group: PickerGroup) => (
                <Combobox.Group
                  key={group.value}
                  items={group.items}
                  className="collection-picker__group"
                >
                  <Combobox.GroupLabel className="collection-picker__group-label">
                    {group.value}
                  </Combobox.GroupLabel>
                  <Combobox.Collection>
                    {(collection: CollectionCatalogEntry) => (
                      <Combobox.Item
                        key={collection.reference.modelZuid}
                        value={collection}
                        className="collection-picker__item"
                      >
                        <Combobox.ItemIndicator className="collection-picker__indicator">
                          <Check size={14} />
                        </Combobox.ItemIndicator>
                        <span className="collection-picker__item-copy">
                          <strong>{collection.label}</strong>
                          <span>
                            {collection.name} · {collection.reference.modelZuid}
                          </span>
                        </span>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
