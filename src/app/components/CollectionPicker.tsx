import { Check, ChevronsUpDown, LoaderCircle, X } from 'lucide-react';
import { useMemo, type Ref } from 'react';
import type { CollectionCatalogEntry, CollectionCatalogGroup, ModelZuid } from '../../domain';
import { Combobox } from './ui/combobox';
import { Field, FieldLabel } from './ui/field';

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
  readonly loading?: boolean;
  readonly error?: string | undefined;
  readonly inputRef?: Ref<HTMLInputElement>;
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
  loading = false,
  error,
  inputRef,
}: CollectionPickerProps) {
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
    <Field error={error}>
      <Combobox.Root
        key={`${value ?? 'empty'}:${selected?.label ?? ''}`}
        items={groups}
        value={selected ?? null}
        onValueChange={(collection) => onChange(collection ?? undefined)}
        itemToStringLabel={(collection) => collection.label}
        isItemEqualToValue={(left, right) => left.reference.modelZuid === right.reference.modelZuid}
        filter={(collection, query) => {
          const searchable = [
            collection.label,
            collection.name,
            collection.reference.modelZuid,
          ].join(' ');
          return searchable.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
        }}
        disabled={disabled}
      >
        <FieldLabel>{label}</FieldLabel>
        <Combobox.InputGroup className="relative flex items-center">
          <Combobox.Input
            ref={inputRef}
            className={`border-input bg-background ring-offset-background placeholder:text-muted-foreground hover:border-ring/60 focus-visible:ring-ring data-invalid:border-destructive data-invalid:focus-visible:ring-destructive/30 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${loading ? 'pr-24' : 'pr-16'}`}
            placeholder={loading ? 'Loading collections…' : 'Search collections'}
          />
          <div className="absolute right-1 flex items-center gap-0.5">
            {loading ? (
              <span
                className="text-muted-foreground inline-flex size-7 items-center justify-center"
                role="status"
                aria-label="Loading collection catalog"
              >
                <LoaderCircle className="animate-spin" size={14} aria-hidden="true" />
              </span>
            ) : null}
            <Combobox.Clear
              className="text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
              aria-label="Clear selection"
            >
              <X size={14} />
            </Combobox.Clear>
            <Combobox.Trigger
              className="text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
              aria-label="Show collections"
              aria-labelledby={undefined}
            >
              <ChevronsUpDown size={14} />
            </Combobox.Trigger>
          </div>
        </Combobox.InputGroup>
        <Combobox.Portal>
          <Combobox.Positioner className="z-50" sideOffset={5}>
            <Combobox.Popup className="bg-popover text-popover-foreground max-h-80 min-w-[var(--anchor-width)] overflow-hidden rounded-md border shadow-md">
              <Combobox.Empty>
                <div className="text-muted-foreground px-3 py-6 text-center text-sm">
                  No collections found.
                </div>
              </Combobox.Empty>
              <Combobox.List className="max-h-72 overflow-y-auto p-1 outline-none">
                {(group: PickerGroup) => (
                  <Combobox.Group key={group.value} items={group.items} className="py-1">
                    <Combobox.GroupLabel className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                      {group.value}
                    </Combobox.GroupLabel>
                    <Combobox.Collection>
                      {(collection: CollectionCatalogEntry) => (
                        <Combobox.Item
                          key={collection.reference.modelZuid}
                          value={collection}
                          className="data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground hover:bg-surface-menu-hover relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none select-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                        >
                          <Combobox.ItemIndicator className="flex size-4 shrink-0 items-center justify-center">
                            <Check size={14} />
                          </Combobox.ItemIndicator>
                          <span className="flex min-w-0 flex-col">
                            <strong className="truncate font-medium">{collection.label}</strong>
                            <span className="text-muted-foreground truncate text-xs">
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
    </Field>
  );
}
