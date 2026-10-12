import { X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ViewFilter } from '../../domain';
import {
  conditionsFor,
  draftFromFilter,
  emptyDraft,
  filterFromDraft,
  type DraftInput,
  type FilterDraft,
  type FilterField,
} from '../filter-fields';
import { useFieldProblem } from '../hooks/useFieldProblem';
import { ValueControl, type FilterContext } from './FilterEditor';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

/** Which list a nested table's column filter lives in: the table's own, or the view's. */
export type FilterScope = 'table' | 'view';

/** The names a nested table's "Apply to" choice reads with. */
export interface ScopeChoice {
  /** The view's root collection, e.g. `Pages`. */
  readonly root: string;
  /** This table's collection, e.g. `Sections`. */
  readonly node: string;
}

interface ColumnFilterFormProps {
  /** Names the form for assistive technology, e.g. `View filter`. */
  readonly label: string;
  readonly field: FilterField;
  /** The filter being edited; undefined to add one. */
  readonly filter: ViewFilter | undefined;
  readonly scope: FilterScope;
  /** Set in nested tables, which offer the "Apply to" choice. */
  readonly scopeChoice: ScopeChoice | undefined;
  readonly itemsFor: FilterContext['itemsFor'];
  /** Writes the filter, `nodePath` relative to the table, into the list of `scope`. */
  readonly onApply: (filter: ViewFilter, scope: FilterScope) => void;
  /** Moves the existing filter, unchanged, to the list of `scope`. */
  readonly onMove: (scope: FilterScope) => void;
  readonly onClear: () => void;
}

/** Condition and value of one field's filter, plus the scope choice in nested tables. */
export function ColumnFilterForm({
  label,
  field,
  filter,
  scope: currentScope,
  scopeChoice,
  itemsFor,
  onApply,
  onMove,
  onClear,
}: ColumnFilterFormProps) {
  const [draft, setDraft] = useState(() => (filter ? draftFromFilter(filter) : emptyDraft(field)));
  const [scope, setScope] = useState(currentScope);
  const valueControl = useRef<HTMLElement | null>(null);
  const upperControl = useRef<HTMLElement | null>(null);
  const problem = useFieldProblem<DraftInput>({ value: valueControl, upper: upperControl });
  const message = problem.field ? problem.messageFor(problem.field) : undefined;
  const focusValueOnConditionChange = useRef(false);
  const conditions = conditionsFor(field.field);
  const condition = conditions.find((candidate) => candidate.id === draft.condition);

  useEffect(() => {
    if (!focusValueOnConditionChange.current) return;
    focusValueOnConditionChange.current = false;
    valueControl.current?.focus();
  }, [draft.condition]);

  function update(patch: Partial<FilterDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    problem.clear();
  }

  function chooseScope(next: FilterScope) {
    setScope(next);
    if (filter) onMove(next);
  }

  function submit() {
    const result = filterFromDraft(draft, field, filter?.id ?? crypto.randomUUID());
    if (!result.ok) {
      problem.report(result.input, result.problem);
      return;
    }
    onApply(result.filter, scope);
  }

  function submitOnEnter(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  }

  return (
    <div className="grid gap-2 px-2 pt-1.5 pb-2" role="group" aria-label={label}>
      <p className="m-0 text-[10px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
        Filter
      </p>
      {scopeChoice ? (
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Apply to</span>
            <ToggleGroup
              aria-label="Apply filter to"
              value={[scope]}
              onValueChange={([next]) => {
                if (next) chooseScope(next);
              }}
            >
              <ToggleGroupItem value="table">This table</ToggleGroupItem>
              <ToggleGroupItem value="view">All {scopeChoice.root}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <p className="m-0 text-[11px] leading-snug text-muted-foreground">
            {scope === 'view'
              ? `Keeps only ${scopeChoice.root} items that have a matching ${scopeChoice.node}.`
              : `Filters ${scopeChoice.node} rows only; every ${scopeChoice.root} item stays.`}
          </p>
        </div>
      ) : null}
      <Select
        items={conditions.map((candidate) => ({ label: candidate.label, value: candidate.id }))}
        value={draft.condition}
        onValueChange={(next) => {
          if (next === null) return;
          focusValueOnConditionChange.current = true;
          update({ condition: next });
        }}
      >
        <SelectTrigger className="w-full" size="sm" aria-label={`${label} condition`}>
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
      {message ? (
        <p className="m-0 text-xs text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        {filter ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X className="size-3.5" aria-hidden="true" /> Clear filter
          </Button>
        ) : null}
        <Button type="button" size="sm" className="ml-auto" onClick={submit}>
          {filter ? 'Update filter' : 'Apply filter'}
        </Button>
      </div>
    </div>
  );
}
