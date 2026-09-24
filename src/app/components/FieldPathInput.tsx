import { Autocomplete } from '@base-ui/react/autocomplete';
import { useState, type Ref } from 'react';
import { Field, FieldLabel } from './ui/field';
import { Input } from './ui/input';

interface FieldPathInputProps {
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly paths: readonly string[];
  readonly placeholder?: string;
  readonly error?: string | undefined;
  readonly inputRef?: Ref<HTMLInputElement>;
}

// A path that is already typed out in full needs no suggestion.
function suggestsPath(path: string, query: string): boolean {
  const typed = query.trim().toLocaleLowerCase();
  return path.toLocaleLowerCase() !== typed && path.toLocaleLowerCase().includes(typed);
}

/** Free-text field path input that suggests the collection's known field paths. */
export function FieldPathInput({
  label,
  value,
  onValueChange,
  paths,
  placeholder,
  error,
  inputRef,
}: FieldPathInputProps) {
  const [open, setOpen] = useState(false);
  const suggestions = paths.filter((path) => suggestsPath(path, value));
  return (
    <Field error={error}>
      <FieldLabel>{label}</FieldLabel>
      <Autocomplete.Root
        items={suggestions}
        filter={null}
        value={value}
        onValueChange={onValueChange}
        open={open && suggestions.length > 0}
        onOpenChange={setOpen}
      >
        <Autocomplete.Input render={<Input />} ref={inputRef} placeholder={placeholder} />
        <Autocomplete.Portal>
          <Autocomplete.Positioner className="z-50" sideOffset={5}>
            <Autocomplete.Popup className="bg-popover text-popover-foreground max-h-72 w-[var(--anchor-width)] max-w-[var(--available-width)] overflow-hidden rounded-md border shadow-md">
              <Autocomplete.List className="max-h-72 overflow-y-auto p-1 outline-none data-empty:p-0">
                {(path: string) => (
                  <Autocomplete.Item
                    key={path}
                    value={path}
                    className="data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex cursor-pointer items-center rounded-sm px-2 py-1.5 font-mono text-xs outline-none select-none"
                  >
                    {path}
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
    </Field>
  );
}
