import { Check, ChevronsUpDown, CornerDownLeft, Funnel, ListFilter, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ContentItem, ViewFilter } from '../../domain';
import { isDateOnly } from '../../explorer-core';
import {
  conditionsFor,
  describeFilter,
  draftFromFilter,
  editsField,
  emptyDraft,
  filterFromDraft,
  filterOptions,
  optionCounts,
  type Condition,
  type DraftInput,
  type FilterDraft,
  type FilterField,
  type FilterFieldGroup,
  type FilterFields,
} from '../filter-fields';
import { useFieldProblem } from '../hooks/useFieldProblem';
import { Button } from './ui/button';
import { Checkbox, CheckboxGroup } from './ui/checkbox';
import { Combobox } from './ui/combobox';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export interface FilterContext {
  /** Names the editor for assistive technology, e.g. `View filter`. */
  readonly label: string;
  /** The collection node whose rows the filter keeps, used in the related-items hint. */
  readonly subject: string;
  readonly fields: FilterFields;
  /** The items a field's option counts cover; undefined while the field's node loads. */
  readonly itemsFor: (field: FilterField) => readonly ContentItem[] | undefined;
}

/** A filter context plus the filter list its controls edit. */
export interface FilterListContext extends FilterContext {
  readonly filters: readonly ViewFilter[];
  readonly onChange: (filters: readonly ViewFilter[]) => void;
}

// `filters` with `next` in place of the filter that has its id, or added at the end.
function withFilter(filters: readonly ViewFilter[], next: ViewFilter): readonly ViewFilter[] {
  return filters.some((filter) => filter.id === next.id)
    ? filters.map((filter) => (filter.id === next.id ? next : filter))
    : [...filters, next];
}

interface FilterPopoverProps extends FilterListContext {
  /** The `PopoverTrigger` that opens the editor. */
  readonly trigger: ReactNode;
  readonly align: 'start' | 'end';
  /** The filter to edit; omit to add one. */
  readonly filter?: ViewFilter | undefined;
  /** The field the editor is fixed on; omit to let the user pick one. */
  readonly field?: FilterField | undefined;
}

// Opens the filter editor from `trigger` and writes the submitted filter into `filters`.
function FilterPopover({ trigger, align, filters, onChange, ...editor }: FilterPopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {trigger}
      <PopoverContent align={align} className="p-0">
        <FilterEditor
          {...editor}
          onSubmit={(next) => {
            onChange(withFilter(filters, next));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Funnel in a column header: edits the column's filter, or adds one. */
export function ColumnFilterButton({
  field,
  ...context
}: FilterListContext & { field: FilterField }) {
  const existing = context.filters.find((filter) => editsField(filter, field));
  return (
    <FilterPopover
      {...context}
      align="start"
      filter={existing}
      field={field}
      trigger={
        <PopoverTrigger
          className={`inline-flex size-5.5 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-[opacity,color,background-color] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/45 data-popup-open:opacity-100 ${
            existing
              ? 'bg-primary/14 text-primary hover:bg-primary/22'
              : 'text-muted-foreground opacity-0 group-hover/head:opacity-100 hover:bg-surface-menu-hover hover:text-foreground'
          }`}
          aria-label={`Filter by ${field.field.label}`}
        >
          <Funnel size={12} strokeWidth={2.5} fill={existing ? 'currentColor' : 'none'} />
        </PopoverTrigger>
      }
    />
  );
}

/** Toolbar button that opens an empty filter editor. */
export function AddFilterButton({
  addLabel,
  ...context
}: FilterListContext & { addLabel: string }) {
  return (
    <FilterPopover
      {...context}
      align="end"
      trigger={
        <PopoverTrigger
          render={
            <Button variant="outline" aria-label={addLabel}>
              <ListFilter size={14} /> Filter
            </Button>
          }
        />
      }
    />
  );
}

/** An active filter as a readable pill: the text edits the filter and × removes it. */
export function FilterChip({ filter, ...context }: FilterListContext & { filter: ViewFilter }) {
  const description = describeFilter(filter, context.fields);
  const summary = description.scope
    ? `${description.scope}: ${description.text}`
    : description.text;
  return (
    <span
      className={`inline-flex h-7 max-w-full items-center rounded-full border text-xs font-medium transition-colors ${
        description.stale
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-primary/25 bg-primary/8 text-foreground hover:border-primary/45 hover:bg-primary/12'
      }`}
    >
      <FilterPopover
        {...context}
        align="start"
        filter={filter}
        field={description.field}
        trigger={
          <PopoverTrigger
            disabled={description.stale}
            className="flex min-w-0 cursor-pointer items-center gap-1 rounded-l-full py-1 pr-1 pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:cursor-default"
            aria-label={
              description.stale ? `${summary} (cannot be edited here)` : `Edit filter ${summary}`
            }
          >
            {description.scope ? (
              <span className="text-muted-foreground">{description.scope}:</span>
            ) : null}
            <span className="truncate">{description.text}</span>
          </PopoverTrigger>
        }
      />
      <button
        type="button"
        className="mr-0.5 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-surface-menu-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/45"
        aria-label={`Remove filter ${summary}`}
        onClick={() => context.onChange(context.filters.filter(({ id }) => id !== filter.id))}
      >
        <X size={12} />
      </button>
    </span>
  );
}

interface FilterChipRowProps {
  readonly heading: string | undefined;
  readonly onClearAll: () => void;
  readonly children: ReactNode;
}

/** The strip under a table toolbar that holds its active filter chips. */
export function FilterChipRow({ heading, onClearAll, children }: FilterChipRowProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-subtle/60 px-3.5 py-2"
      aria-label="Active filters"
      role="group"
    >
      {heading ? (
        <span className="mr-1 text-[10px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
          {heading}
        </span>
      ) : null}
      {children}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={onClearAll}
      >
        Clear all
      </Button>
    </div>
  );
}

function fieldText(field: FilterField): string {
  return field.scope ? `${field.scope} › ${field.field.label}` : field.field.label;
}

interface FilterEditorProps extends FilterContext {
  readonly filter?: ViewFilter | undefined;
  readonly field?: FilterField | undefined;
  readonly onSubmit: (filter: ViewFilter) => void;
}

// One filter, written as `field · condition · value`. Enter in a value input applies it.
function FilterEditor({
  label,
  subject,
  fields,
  itemsFor,
  filter,
  field: fixedField,
  onSubmit,
}: FilterEditorProps) {
  const [field, setField] = useState(fixedField);
  const [draft, setDraft] = useState(() =>
    filter ? draftFromFilter(filter) : emptyDraft(fixedField),
  );
  const valueControl = useRef<HTMLElement | null>(null);
  const upperControl = useRef<HTMLElement | null>(null);
  const problem = useFieldProblem<DraftInput>({ value: valueControl, upper: upperControl });
  const message = problem.field ? problem.messageFor(problem.field) : undefined;
  // An editor that opens on a known field starts in its value control.
  const focusValueOnFieldChange = useRef(fixedField !== undefined);
  const conditions = field ? conditionsFor(field.field) : [];
  const condition = conditions.find((candidate) => candidate.id === draft.condition);

  useEffect(() => {
    if (!focusValueOnFieldChange.current) return;
    focusValueOnFieldChange.current = false;
    valueControl.current?.focus();
  }, [field, draft.condition]);

  function update(patch: Partial<FilterDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    problem.clear();
  }

  function chooseField(next: FilterField) {
    focusValueOnFieldChange.current = true;
    const keepsCondition =
      field !== undefined &&
      conditionsFor(next.field).some((candidate) => candidate.id === draft.condition);
    setField(next);
    setDraft((current) => ({
      ...emptyDraft(next),
      ...(keepsCondition ? { condition: current.condition } : {}),
      value: current.value,
    }));
    problem.clear();
  }

  function submit() {
    if (!field) return;
    const result = filterFromDraft(draft, field, filter?.id ?? crypto.randomUUID());
    if (!result.ok) {
      problem.report(result.input, result.problem);
      return;
    }
    onSubmit(result.filter);
  }

  function submitOnEnter(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  }

  return (
    <div className="grid w-[min(480px,calc(100vw-2rem))] gap-3 p-3" role="group" aria-label={label}>
      {/* A column funnel or a chip already names the field, so only the toolbar editor picks one. */}
      {fixedField ? (
        <p className="m-0 min-w-0 truncate text-sm">
          <span className="text-muted-foreground">Filter by </span>
          <strong className="font-semibold">{fieldText(fixedField)}</strong>
        </p>
      ) : (
        <FieldPicker label={label} groups={fields.groups} field={field} onChoose={chooseField} />
      )}
      {field?.scope ? (
        <p className="-mt-1 m-0 text-[11px] leading-snug text-muted-foreground">
          Keeps a {subject} row when at least one related{' '}
          <span className="text-foreground/80">{field.scope}</span> item matches.
        </p>
      ) : null}
      {field ? (
        <div className="flex items-start gap-2">
          <Select
            items={conditions.map((candidate) => ({ label: candidate.label, value: candidate.id }))}
            value={draft.condition}
            onValueChange={(next) => {
              if (next === null) return;
              focusValueOnFieldChange.current = true;
              update({ condition: next });
            }}
          >
            <SelectTrigger className="w-32 shrink-0" aria-label={`${label} condition`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {conditions.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="min-w-0 flex-1">
            {condition ? (
              <ValueControl
                label={label}
                field={field}
                condition={condition}
                draft={draft}
                problemInput={problem.field}
                itemsFor={itemsFor}
                controlRef={(element) => {
                  valueControl.current = element;
                }}
                upperRef={(element) => {
                  upperControl.current = element;
                }}
                onChange={update}
                onKeyDown={submitOnEnter}
              />
            ) : null}
          </div>
          <Button type="button" className="shrink-0" onClick={submit}>
            {filter ? 'Update' : 'Add filter'}
            <CornerDownLeft className="size-3 opacity-60" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      {message ? (
        <p className="-mt-1 m-0 text-xs text-destructive" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}

interface FieldPickerProps {
  readonly label: string;
  readonly groups: readonly FilterFieldGroup[];
  readonly field: FilterField | undefined;
  readonly onChoose: (field: FilterField) => void;
}

// Searchable field list for a new filter, grouped by collection; it opens as soon as it mounts.
function FieldPicker({ label, groups, field, onChoose }: FieldPickerProps) {
  return (
    <Combobox.Root
      items={groups}
      value={field ?? null}
      onValueChange={(next) => {
        if (next) onChoose(next);
      }}
      itemToStringLabel={fieldText}
      isItemEqualToValue={(left, right) => left.key === right.key}
      // Fields only, not their collection, so a collection's name doesn't list all of its fields.
      filter={(candidate, query) =>
        [candidate.field.label, candidate.field.name]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase())
      }
      defaultOpen
      openOnInputClick
      autoHighlight
    >
      <Combobox.InputGroup className="relative flex items-center">
        <Combobox.Input
          render={<Input className="pr-9" />}
          autoFocus
          aria-label={`${label} field`}
          placeholder="Search fields…"
        />
        <Combobox.Trigger
          className="absolute right-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-surface-menu-hover hover:text-foreground"
          aria-label="Show fields"
        >
          <ChevronsUpDown size={14} />
        </Combobox.Trigger>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner className="isolate z-50" sideOffset={4}>
          <Combobox.Popup className="max-h-[min(22rem,var(--available-height))] w-[var(--anchor-width)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl">
            <Combobox.Empty>
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No fields match.
              </div>
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(22rem,var(--available-height))] overflow-y-auto px-1 pb-1 outline-none">
              {(group: FilterFieldGroup) => (
                <Combobox.Group key={group.label} items={group.items} className="pb-1">
                  <Combobox.GroupLabel className="sticky top-0 z-1 bg-popover px-2 pt-2 pb-1 text-[10px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
                    {group.label}
                  </Combobox.GroupLabel>
                  <Combobox.Collection>
                    {(candidate: FilterField) => (
                      <Combobox.Item
                        key={candidate.key}
                        value={candidate}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-surface-menu-hover"
                      >
                        <Combobox.ItemIndicator className="flex size-3.5 shrink-0 items-center justify-center text-primary">
                          <Check size={13} />
                        </Combobox.ItemIndicator>
                        <span className="min-w-0 flex-1 truncate">{candidate.field.label}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {candidate.field.options?.length ? 'options' : candidate.field.kind}
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

interface ValueControlProps {
  readonly label: string;
  readonly field: FilterField;
  readonly condition: Condition;
  readonly draft: FilterDraft;
  /** The input whose value has a problem, if any. */
  readonly problemInput: DraftInput | undefined;
  readonly itemsFor: FilterContext['itemsFor'];
  readonly controlRef: (element: HTMLElement | null) => void;
  readonly upperRef: (element: HTMLElement | null) => void;
  readonly onChange: (patch: Partial<FilterDraft>) => void;
  readonly onKeyDown: (event: KeyboardEvent) => void;
}

function ValueControl({
  label,
  field,
  condition,
  draft,
  problemInput,
  itemsFor,
  controlRef,
  upperRef,
  onChange,
  onKeyDown,
}: ValueControlProps) {
  const optionIdPrefix = useId();
  const invalid = problemInput === 'value' || undefined;
  if (condition.input === 'none') return null;
  if (condition.input === 'options') {
    const items = itemsFor(field);
    const counts = items ? optionCounts(field.field, items) : undefined;
    return (
      <div className="grid gap-1">
        <CheckboxGroup
          aria-label={`${label} value`}
          aria-invalid={invalid}
          className="grid max-h-52 overflow-y-auto rounded-lg border border-input bg-input/30 p-1 aria-invalid:border-destructive/60"
          value={[...draft.options]}
          onValueChange={(options) => onChange({ options })}
          onKeyDown={onKeyDown}
        >
          {filterOptions(field.field).map((option, index) => {
            const count = counts?.get(option.key);
            return (
              <label
                key={option.key}
                className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-surface-menu-hover has-focus-visible:bg-surface-menu-hover"
              >
                <Checkbox
                  ref={index === 0 ? controlRef : undefined}
                  value={option.key}
                  aria-labelledby={`${optionIdPrefix}-${index}`}
                />
                {/* Names the checkbox in one phrase, e.g. `In review (12)`. */}
                <span id={`${optionIdPrefix}-${index}`} className="sr-only">
                  {count === undefined ? option.label : `${option.label} (${count})`}
                </span>
                <span className="min-w-0 flex-1 truncate" aria-hidden="true">
                  {option.label}
                </span>
                {count === undefined ? null : (
                  <span
                    className={`text-[11px] tabular-nums ${count === 0 ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}
                    aria-hidden="true"
                  >
                    {count}
                  </span>
                )}
              </label>
            );
          })}
        </CheckboxGroup>
        {items ? (
          <span className="px-1 text-[10px] text-muted-foreground">
            Counts across {items.length} {field.scope ? 'related ' : ''}
            {field.node.name} items in this table
          </span>
        ) : null}
      </div>
    );
  }
  // A date picker cannot show a timestamp, e.g. from an older link, so that edits as text.
  const operands = condition.id === 'between' ? [draft.value, draft.upper] : [draft.value];
  const datePicker =
    condition.input === 'date' &&
    operands.every((operand) => operand === '' || isDateOnly(operand));
  const type = datePicker ? 'date' : 'text';
  const inputMode = condition.input === 'number' ? 'decimal' : undefined;
  if (condition.id === 'between') {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          ref={controlRef}
          type={type}
          inputMode={inputMode}
          aria-label={`${label} lower value`}
          aria-invalid={invalid}
          placeholder="From"
          value={draft.value}
          onChange={(event) => onChange({ value: event.target.value })}
          onKeyDown={onKeyDown}
        />
        <span className="text-xs text-muted-foreground">and</span>
        <Input
          ref={upperRef}
          type={type}
          inputMode={inputMode}
          aria-label={`${label} upper value`}
          aria-invalid={problemInput === 'upper' || undefined}
          placeholder="To"
          value={draft.upper}
          onChange={(event) => onChange({ upper: event.target.value })}
          onKeyDown={onKeyDown}
        />
      </div>
    );
  }
  return (
    <Input
      ref={controlRef}
      type={type}
      inputMode={inputMode}
      aria-label={`${label} value`}
      aria-invalid={invalid}
      placeholder={condition.input === 'number' ? 'Number' : 'Value'}
      value={draft.value}
      onChange={(event) => onChange({ value: event.target.value })}
      onKeyDown={onKeyDown}
    />
  );
}
