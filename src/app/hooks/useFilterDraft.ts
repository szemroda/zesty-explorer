import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ViewFilter } from '../../domain';
import {
  conditionsFor,
  draftFromFilter,
  emptyDraft,
  filterFromDraft,
  type ConditionId,
  type DraftInput,
  type FilterDraft,
  type FilterField,
} from '../filter-fields';
import { useFieldProblem } from './useFieldProblem';

/** What the editor's value control needs from its draft: the values, focus targets, and Enter. */
export interface DraftValueProps {
  readonly draft: FilterDraft;
  /** The input whose value has a problem, if any. */
  readonly problemInput: DraftInput | undefined;
  readonly controlRef: (element: HTMLElement | null) => void;
  readonly upperRef: (element: HTMLElement | null) => void;
  readonly onChange: (patch: Partial<FilterDraft>) => void;
  readonly onKeyDown: (event: KeyboardEvent) => void;
}

/**
 * The condition and value the filter editor edits on `field`, checked on submit. `submit` passes
 * the filter to `onSubmit`, keeping the id of `filter` when it edits one. An editor that opens on a
 * known field starts in its value control.
 */
export function useFilterDraft(
  field: FilterField | undefined,
  filter: ViewFilter | undefined,
  onSubmit: (filter: ViewFilter) => void,
) {
  const [draft, setDraft] = useState(() => (filter ? draftFromFilter(filter) : emptyDraft(field)));
  const valueControl = useRef<HTMLElement | null>(null);
  const upperControl = useRef<HTMLElement | null>(null);
  const problem = useFieldProblem<DraftInput>({ value: valueControl, upper: upperControl });
  const focusValue = useRef(field !== undefined);
  const conditions = field ? conditionsFor(field.field) : [];

  useEffect(() => {
    if (!focusValue.current) return;
    focusValue.current = false;
    valueControl.current?.focus();
  }, [field, draft.condition]);

  function update(patch: Partial<FilterDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
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

  const valueProps: DraftValueProps = {
    draft,
    problemInput: problem.field,
    controlRef: (element) => {
      valueControl.current = element;
    },
    upperRef: (element) => {
      upperControl.current = element;
    },
    onChange: update,
    onKeyDown: (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    },
  };

  return {
    draft,
    conditions,
    condition: conditions.find((candidate) => candidate.id === draft.condition),
    message: problem.field ? problem.messageFor(problem.field) : undefined,
    valueProps,
    submit,
    /** Sets the condition and moves focus to its value control. */
    chooseCondition: (next: ConditionId) => {
      focusValue.current = true;
      update({ condition: next });
    },
    /**
     * Starts the draft over for `next`, which the caller makes the new `field`. The typed value
     * stays, and so does the condition when `next` offers it.
     */
    changeField: (next: FilterField) => {
      focusValue.current = true;
      const keepsCondition =
        field !== undefined &&
        conditionsFor(next.field).some((candidate) => candidate.id === draft.condition);
      setDraft((current) => ({
        ...emptyDraft(next),
        ...(keepsCondition ? { condition: current.condition } : {}),
        value: current.value,
      }));
      problem.clear();
    },
  };
}
