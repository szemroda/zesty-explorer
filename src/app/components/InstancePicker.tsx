import { Check, ChevronsUpDown, LoaderCircle, X } from 'lucide-react';
import { useMemo, type Ref } from 'react';
import { deploymentLabels, type InstanceListEntry, type InstanceReference } from '../../domain';
import { describeExplorerError } from '../error-message';
import type { InstanceListQueryResult } from '../hooks/useInstanceList';
import { ErrorTechnicalDetails } from './ErrorTechnicalDetails';
import { Button } from './ui/button';
import { Combobox } from './ui/combobox';
import { Field, FieldLabel } from './ui/field';

interface InstancePickerProps {
  readonly query: InstanceListQueryResult;
  readonly value: InstanceReference | undefined;
  readonly onChange: (instance: InstanceReference | undefined) => void;
  readonly disabled?: boolean;
  readonly error?: string | undefined;
  readonly inputRef?: Ref<HTMLInputElement>;
}

interface InstanceChoice extends InstanceListEntry {
  readonly unlisted?: true;
}

export function InstancePicker({
  query,
  value,
  onChange,
  disabled = false,
  error,
  inputRef,
}: InstancePickerProps) {
  const listed = useMemo(
    () =>
      (query.list?.instances ?? []).toSorted((left, right) => {
        const unnamed = Number(!left.name) - Number(!right.name);
        return (
          unnamed ||
          (left.name ?? '').localeCompare(right.name ?? '', undefined, { sensitivity: 'base' }) ||
          left.reference.instanceZuid.localeCompare(right.reference.instanceZuid)
        );
      }),
    [query.list],
  );
  const selected: InstanceChoice | undefined = value
    ? (listed.find(
        (entry) =>
          entry.reference.instanceZuid === value.instanceZuid &&
          entry.reference.deployment === value.deployment,
      ) ?? { reference: value, unlisted: true })
    : undefined;
  const choices: readonly InstanceChoice[] = selected?.unlisted ? [selected, ...listed] : listed;
  const loading = query.isLoading;
  const failure = query.error
    ? describeExplorerError(query.error, window.location.origin)
    : undefined;
  const list = query.list;

  return (
    <div className="grid gap-3">
      <Field error={error}>
        <Combobox.Root
          key={`${value?.instanceZuid ?? 'empty'}:${selected?.name ?? ''}`}
          items={choices}
          value={selected ?? null}
          onValueChange={(choice) => onChange(choice?.reference)}
          itemToStringLabel={(choice) => choice.name ?? choice.reference.instanceZuid}
          isItemEqualToValue={(left, right) =>
            left.reference.instanceZuid === right.reference.instanceZuid &&
            left.reference.deployment === right.reference.deployment
          }
          filter={(choice, search) =>
            `${choice.name ?? ''} ${choice.reference.instanceZuid}`
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase())
          }
          disabled={disabled}
        >
          <FieldLabel>Instance</FieldLabel>
          <Combobox.InputGroup className="relative flex items-center">
            <Combobox.Input
              ref={inputRef}
              autoFocus={!value}
              className={`border-input bg-background ring-offset-background placeholder:text-muted-foreground hover:border-ring/60 focus-visible:ring-ring data-invalid:border-destructive data-invalid:focus-visible:ring-destructive/30 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${loading ? 'pr-24' : 'pr-16'}`}
              placeholder={loading ? 'Loading instances…' : 'Search instances by name or ZUID'}
            />
            <div className="absolute right-1 flex items-center gap-0.5">
              {loading ? (
                <span
                  className="text-muted-foreground inline-flex size-7 items-center justify-center"
                  role="status"
                  aria-label="Loading instance list"
                >
                  <LoaderCircle className="animate-spin" size={14} aria-hidden="true" />
                </span>
              ) : null}
              <Combobox.Clear
                className="text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
                aria-label="Clear instance selection"
              >
                <X size={14} />
              </Combobox.Clear>
              <Combobox.Trigger
                className="text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
                aria-label="Show instances"
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
                    No instances found.
                  </div>
                </Combobox.Empty>
                <Combobox.List className="max-h-72 overflow-y-auto p-1 outline-none">
                  {(choice: InstanceChoice) => (
                    <Combobox.Item
                      key={choice.reference.instanceZuid}
                      value={choice}
                      className="data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground hover:bg-surface-menu-hover relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none select-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                    >
                      <Combobox.ItemIndicator className="flex size-4 shrink-0 items-center justify-center">
                        <Check size={14} />
                      </Combobox.ItemIndicator>
                      <span className="flex min-w-0 flex-col">
                        <strong className="truncate font-medium">
                          {choice.name ?? choice.reference.instanceZuid}
                        </strong>
                        <span className="text-muted-foreground truncate text-xs">
                          {choice.unlisted
                            ? 'Not in your instance list'
                            : choice.reference.instanceZuid}
                        </span>
                      </span>
                    </Combobox.Item>
                  )}
                </Combobox.List>
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
      </Field>
      {query.error && failure ? (
        <div
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
          role="alert"
        >
          <p>{failure.message}</p>
          <p>{failure.recovery}</p>
          <p>Paste a Zesty URL below to open an instance directly.</p>
          <ErrorTechnicalDetails error={query.error} />
          <Button type="button" variant="outline" onClick={() => void query.refresh()}>
            Retry instance list
          </Button>
        </div>
      ) : list?.warning || list?.truncated ? (
        <div
          className="border-amber-500/40 bg-amber-500/10 rounded-md border p-3 text-sm"
          role="status"
        >
          {list.warning ? <p>{list.warning.message}</p> : null}
          {list.truncated ? (
            <p>
              Zesty returned {list.truncated.returned} of {list.truncated.total} instances.
            </p>
          ) : null}
          <p>Paste a Zesty URL below to open one that is missing.</p>
          {list.warning ? <ErrorTechnicalDetails error={list.warning} /> : null}
        </div>
      ) : list && list.instances.length === 0 ? (
        <p className="bg-muted text-muted-foreground rounded-md p-3 text-sm" role="status">
          Zesty lists no {deploymentLabels[list.deployment]} instances for this session token. If
          you work in stage or development, choose Back and pick that deployment. Or paste a Zesty
          URL below.
        </p>
      ) : null}
    </div>
  );
}
