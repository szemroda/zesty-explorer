import { X } from 'lucide-react';
import { useState } from 'react';
import type { ViewFilter } from '../../domain';
import type { FilterField } from '../filter-fields';
import { useFilterDraft } from '../hooks/useFilterDraft';
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
  onClear,
}: ColumnFilterFormProps) {
  const [scope, setScope] = useState(currentScope);
  const { draft, conditions, condition, message, valueProps, submit, chooseCondition } =
    useFilterDraft(field, filter, (next) => onApply(next, scope), false);

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
                if (next) setScope(next);
              }}
            >
              <ToggleGroupItem value="table">This table</ToggleGroupItem>
              <ToggleGroupItem value="view">All {scopeChoice.root}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <p className="m-0 text-[11px] leading-snug text-muted-foreground">
            {scope === 'view'
              ? `Keeps only ${scopeChoice.root} with at least one matching item in ${scopeChoice.node}.`
              : `Filters only these ${scopeChoice.node} rows; all ${scopeChoice.root} stay.`}
          </p>
        </div>
      ) : null}
      <Select
        items={conditions.map((candidate) => ({ label: candidate.label, value: candidate.id }))}
        value={draft.condition}
        onValueChange={(next) => {
          if (next !== null) chooseCondition(next);
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
          {...valueProps}
          label={label}
          field={field}
          condition={condition}
          itemsFor={itemsFor}
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
