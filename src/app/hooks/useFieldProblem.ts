import { useState, type RefObject } from 'react';

interface FieldProblem<Field extends string> {
  readonly field: Field;
  readonly message: string;
}

/**
 * Tracks the one validation problem a form shows at a time. Reporting a problem moves focus
 * to the field's control, so pass a ref for every field the form can report on.
 */
export function useFieldProblem<Field extends string>(
  controls: Readonly<Record<Field, RefObject<HTMLElement | null>>>,
) {
  const [problem, setProblem] = useState<FieldProblem<Field>>();
  return {
    report(field: Field, message: string) {
      setProblem({ field, message });
      controls[field].current?.focus();
    },
    messageFor(field: Field): string | undefined {
      return problem?.field === field ? problem.message : undefined;
    },
    // Clears the problem of one field, or any problem when no field is given.
    clear(field?: Field) {
      if (!field || problem?.field === field) setProblem(undefined);
    },
  };
}
