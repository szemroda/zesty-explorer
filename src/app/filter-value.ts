import type { CollectionField, FilterOperator, Scalar } from '../domain';

export type FilterValueResult =
  | { readonly ok: true; readonly value: Scalar | readonly Scalar[] | undefined }
  | { readonly ok: false; readonly problem: string };

const operatorsWithoutValue: readonly FilterOperator[] = [
  'is-empty',
  'is-not-empty',
  'true',
  'false',
];

/** Whether the operator takes a value from the filter builder's value input. */
export function operatorNeedsValue(operator: FilterOperator): boolean {
  return !operatorsWithoutValue.includes(operator);
}

const isoDate = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

// Reads one operand in the field's type. Dates stay ISO strings, which compare in time order.
function scalarInput(value: string, field: CollectionField | undefined): Scalar | undefined {
  if (field?.kind === 'date') {
    return isoDate.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;
  }
  if (field?.kind !== 'number') return value;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function typedValueProblem(field: CollectionField | undefined): string {
  return field?.kind === 'date' ? 'Enter a date as YYYY-MM-DD.' : 'Enter a number.';
}

/** Turns the filter builder's raw value input into a filter value, or explains what is missing. */
export function parseFilterValue(
  value: string,
  field: CollectionField | undefined,
  operator: FilterOperator,
): FilterValueResult {
  if (!operatorNeedsValue(operator)) return { ok: true, value: undefined };
  const parts = value.split(',').map((part) => part.trim());
  if (operator === 'one-of') {
    if (!value.trim()) return { ok: false, problem: 'Choose at least one value.' };
    return {
      ok: true,
      value: parts.map((part) => field?.options?.find((option) => String(option) === part) ?? part),
    };
  }
  if (!value.trim()) return { ok: false, problem: 'Enter a value.' };
  if (operator === 'between') {
    if (parts.length !== 2 || parts.some((part) => !part)) {
      return { ok: false, problem: 'Enter a lower and an upper value, separated by a comma.' };
    }
    const bounds = parts.flatMap((part) => scalarInput(part, field) ?? []);
    if (bounds.length !== parts.length) return { ok: false, problem: typedValueProblem(field) };
    return { ok: true, value: bounds };
  }
  const scalar = scalarInput(value.trim(), field);
  if (scalar === undefined) return { ok: false, problem: typedValueProblem(field) };
  return { ok: true, value: scalar };
}
