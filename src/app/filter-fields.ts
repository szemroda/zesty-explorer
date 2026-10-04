import type {
  CollectionField,
  CollectionNode,
  CollectionNodeId,
  CollectionSchema,
  ContentItem,
  FieldOption,
  FilterOperator,
  Scalar,
  ViewFilter,
} from '../domain';
import { isScalar, optionKey, resolveFieldPath } from '../explorer-core';

/** One field a filter can test: a content field of the table's own node or of a descendant node. */
export interface FilterField {
  /** Stable identity for pickers: node path plus field name. */
  readonly key: string;
  readonly nodePath: readonly CollectionNodeId[];
  /** The node that owns the field, i.e. the last node on `nodePath` or the table's own node. */
  readonly node: CollectionNode;
  /** Node names below the table's own node, e.g. `Sections › Blocks`; undefined for own fields. */
  readonly scope: string | undefined;
  readonly field: CollectionField;
}

/** The fields of one node, shaped as a Base UI combobox group. */
export interface FilterFieldGroup {
  readonly label: string;
  readonly items: readonly FilterField[];
}

/** Every field a filter on one node can test, grouped for the picker and indexed by key. */
export interface FilterFields {
  readonly groups: readonly FilterFieldGroup[];
  readonly byKey: ReadonlyMap<string, FilterField>;
}

function fieldKey(nodePath: readonly CollectionNodeId[], fieldName: string): string {
  return `${nodePath.join('/')}:${fieldName}`;
}

/** Fields a filter on `node` can test, own fields first, then each descendant node's fields. */
export function filterFields(
  node: CollectionNode,
  schemas: ReadonlyMap<CollectionNodeId, CollectionSchema>,
): FilterFields {
  const groups: FilterFieldGroup[] = [];
  const visit = (current: CollectionNode, path: readonly CollectionNodeId[], names: string[]) => {
    const scope = names.length > 0 ? names.join(' › ') : undefined;
    const items = (schemas.get(current.id)?.fields ?? []).map((field): FilterField => ({
      key: fieldKey(path, field.name),
      nodePath: path,
      node: current,
      scope,
      field,
    }));
    if (items.length > 0) groups.push({ label: scope ?? current.name, items });
    current.children.forEach((child) => visit(child, [...path, child.id], [...names, child.name]));
  };
  visit(node, [], []);
  const byKey = new Map(groups.flatMap((group) => group.items.map((item) => [item.key, item])));
  return { groups, byKey };
}

type FilterTarget = Pick<ViewFilter, 'nodePath' | 'fieldPath'>;

// The key of the field a filter tests. Pickers only write whole fields, so a filter on a path
// inside a field, e.g. `payload.caption`, tests no field the editor knows.
function filterKey(filter: FilterTarget): string | undefined {
  const [name, ...rest] = filter.fieldPath;
  return name !== undefined && rest.length === 0 ? fieldKey(filter.nodePath, name) : undefined;
}

/** The field a filter tests, or undefined when it is no longer in the view. */
export function findFilterField(
  fields: FilterFields,
  filter: FilterTarget,
): FilterField | undefined {
  const key = filterKey(filter);
  return key === undefined ? undefined : fields.byKey.get(key);
}

/** Whether `filter` tests exactly `field`, e.g. to find the filter a column header edits. */
export function filtersField(filter: FilterTarget, field: FilterField): boolean {
  return filterKey(filter) === field.key;
}

/** Booleans use the "is" (`one-of`) condition; a single true or false choice saves as that operator. */
export type ConditionId = Exclude<FilterOperator, 'true' | 'false'>;

export type ValueInput = 'none' | 'text' | 'number' | 'date' | 'options';

export interface Condition {
  readonly id: ConditionId;
  readonly label: string;
  readonly input: ValueInput;
}

const isEmpty: Condition = { id: 'is-empty', label: 'is empty', input: 'none' };
const empty: readonly Condition[] = [
  isEmpty,
  { id: 'is-not-empty', label: 'is not empty', input: 'none' },
];

const textConditions: readonly Condition[] = [
  { id: 'contains', label: 'contains', input: 'text' },
  { id: 'equals', label: 'is', input: 'text' },
  { id: 'not-equal', label: 'is not', input: 'text' },
  { id: 'starts-with', label: 'starts with', input: 'text' },
  ...empty,
];

const numberConditions: readonly Condition[] = [
  { id: 'equals', label: '=', input: 'number' },
  { id: 'not-equal', label: '≠', input: 'number' },
  { id: 'greater-than', label: '>', input: 'number' },
  { id: 'less-than', label: '<', input: 'number' },
  { id: 'between', label: 'between', input: 'number' },
  ...empty,
];

const dateConditions: readonly Condition[] = [
  { id: 'less-than', label: 'before', input: 'date' },
  { id: 'greater-than', label: 'after', input: 'date' },
  { id: 'between', label: 'between', input: 'date' },
  { id: 'equals', label: 'on', input: 'date' },
  { id: 'not-equal', label: 'not on', input: 'date' },
  ...empty,
];

const isOneOf: Condition = { id: 'one-of', label: 'is', input: 'options' };
const booleanConditions: readonly Condition[] = [isOneOf, isEmpty];
const optionConditions: readonly Condition[] = [isOneOf, ...empty];

/** Plain-language conditions that suit the field's kind, the most useful first. */
export function conditionsFor(field: CollectionField): readonly Condition[] {
  if (field.options?.length) return optionConditions;
  if (field.kind === 'boolean') return booleanConditions;
  if (field.kind === 'number') return numberConditions;
  if (field.kind === 'date') return dateConditions;
  if (field.kind === 'structured') return empty;
  return textConditions;
}

function conditionIdFor(operator: FilterOperator): ConditionId {
  return operator === 'true' || operator === 'false' ? 'one-of' : operator;
}

// The condition the editor shows for `filter` on `field`; undefined when it has no control for it.
function conditionOf(filter: ViewFilter, field: CollectionField): Condition | undefined {
  if (filter.invalid) return undefined;
  const id = conditionIdFor(filter.operator);
  return conditionsFor(field).find((candidate) => candidate.id === id);
}

/** Whether the editor can open `filter` on `field`, e.g. from the field's column header. */
export function editsField(filter: ViewFilter, field: FilterField): boolean {
  return filtersField(filter, field) && conditionOf(filter, field.field) !== undefined;
}

/** One choice in an option filter; `key` is its `optionKey`, used by drafts and checkboxes. */
export interface FilterOption extends FieldOption {
  readonly key: string;
}

const booleanOptions: readonly FilterOption[] = [
  { key: 'true', label: 'true', value: true },
  { key: 'false', label: 'false', value: false },
];

/** The values an option or boolean field can take, with their display labels. */
export function filterOptions(field: CollectionField): readonly FilterOption[] {
  if (field.options?.length) {
    return field.options.map((option) => ({ ...option, key: optionKey(option.value) }));
  }
  return field.kind === 'boolean' ? booleanOptions : [];
}

/** How many of `items` hold each option of `field`, keyed by option key as the engine matches. */
export function optionCounts(
  field: CollectionField,
  items: readonly ContentItem[],
): ReadonlyMap<string, number> {
  const counts = new Map(filterOptions(field).map((option) => [option.key, 0]));
  for (const item of items) {
    const resolved = resolveFieldPath(item, [field.name]);
    if (resolved.kind !== 'scalar') continue;
    const key = optionKey(resolved.value);
    const count = counts.get(key);
    if (count !== undefined) counts.set(key, count + 1);
  }
  return counts;
}

/** What the filter editor holds while a filter on its field is being written. */
export interface FilterDraft {
  readonly condition: ConditionId;
  readonly value: string;
  /** The upper bound of the `between` condition; `value` holds the lower one. */
  readonly upper: string;
  /** Chosen option keys for the `one-of` condition. */
  readonly options: readonly string[];
}

export function emptyDraft(field: FilterField | undefined): FilterDraft {
  return {
    condition: field ? (conditionsFor(field.field)[0]?.id ?? 'contains') : 'contains',
    value: '',
    upper: '',
    options: [],
  };
}

// Filter values come from links, so anything other than a scalar edits as an empty input.
function scalarText(value: unknown): string {
  return isScalar(value) ? String(value) : '';
}

export function draftFromFilter(filter: ViewFilter): FilterDraft {
  const values: readonly unknown[] = Array.isArray(filter.value) ? filter.value : [];
  const between = filter.operator === 'between';
  return {
    condition: conditionIdFor(filter.operator),
    value: scalarText(between ? values[0] : filter.value),
    upper: between ? scalarText(values[1]) : '',
    options:
      filter.operator === 'true' || filter.operator === 'false'
        ? [filter.operator]
        : filter.operator === 'one-of'
          ? values.filter(isScalar).map(optionKey)
          : [],
  };
}

export type ScalarResult =
  { readonly ok: true; readonly value: Scalar } | { readonly ok: false; readonly problem: string };

/** A draft's value inputs: `value`, or the `upper` bound of a range. */
export type DraftInput = 'value' | 'upper';

export type DraftResult =
  | { readonly ok: true; readonly filter: ViewFilter }
  | { readonly ok: false; readonly problem: string; readonly input: DraftInput };

const isoDate = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

/** Reads one typed value for `field`. Dates stay ISO strings, which compare in time order. */
export function parseScalar(text: string, field: CollectionField): ScalarResult {
  const value = text.trim();
  if (!value) return { ok: false, problem: 'Enter a value.' };
  if (field.kind === 'date') {
    return isoDate.test(value) && Number.isFinite(Date.parse(value))
      ? { ok: true, value }
      : { ok: false, problem: 'Enter a date as YYYY-MM-DD.' };
  }
  if (field.kind !== 'number') return { ok: true, value };
  const number = Number(value);
  return Number.isFinite(number)
    ? { ok: true, value: number }
    : { ok: false, problem: 'Enter a number.' };
}

/** Turns a draft into a filter on `field`, keeping `id` when an existing filter is edited. */
export function filterFromDraft(draft: FilterDraft, field: FilterField, id: string): DraftResult {
  const base = { id, nodePath: field.nodePath, fieldPath: [field.field.name] } as const;
  const { condition } = draft;
  if (condition === 'is-empty' || condition === 'is-not-empty') {
    return { ok: true, filter: { ...base, operator: condition } };
  }
  if (condition === 'one-of') {
    const value = filterOptions(field.field)
      .filter((option) => draft.options.includes(option.key))
      .map((option) => option.value);
    if (value.length === 0) {
      return { ok: false, problem: 'Choose at least one value.', input: 'value' };
    }
    // A single boolean keeps the dedicated operator that links have always used.
    const [only] = value;
    if (value.length === 1 && typeof only === 'boolean') {
      return { ok: true, filter: { ...base, operator: only ? 'true' : 'false' } };
    }
    return { ok: true, filter: { ...base, operator: 'one-of', value } };
  }
  if (condition === 'between') {
    if (!draft.value.trim()) return { ok: false, problem: 'Enter a lower value.', input: 'value' };
    if (!draft.upper.trim()) return { ok: false, problem: 'Enter an upper value.', input: 'upper' };
    const lower = parseScalar(draft.value, field.field);
    if (!lower.ok) return { ...lower, input: 'value' };
    const upper = parseScalar(draft.upper, field.field);
    if (!upper.ok) return { ...upper, input: 'upper' };
    return {
      ok: true,
      filter: { ...base, operator: condition, value: [lower.value, upper.value] },
    };
  }
  const value = parseScalar(draft.value, field.field);
  if (!value.ok) return { ...value, input: 'value' };
  return { ok: true, filter: { ...base, operator: condition, value: value.value } };
}

export interface FilterDescription {
  /** The field the filter tests; undefined when it is no longer in the view. */
  readonly field: FilterField | undefined;
  /** Descendant node names, shown before the condition when the field is not the table's own. */
  readonly scope: string | undefined;
  readonly text: string;
  /**
   * The editor cannot open the filter: it names a node or field that is no longer in the view,
   * or a condition its field does not offer. It can still be removed.
   */
  readonly stale: boolean;
}

function formatValue(value: unknown, field: CollectionField | undefined): string {
  if (Array.isArray(value)) return value.map((part) => formatValue(part, field)).join(', ');
  if (field?.options?.length && isScalar(value)) {
    const key = optionKey(value);
    return filterOptions(field).find((option) => option.key === key)?.label ?? key;
  }
  if (typeof value === 'string' && field?.kind !== 'date') return `“${value}”`;
  return String(value);
}

/** Reads a filter as a short sentence, e.g. `Active is true` or `Score between 10 and 20`. */
export function describeFilter(filter: ViewFilter, fields: FilterFields): FilterDescription {
  const found = findFilterField(fields, filter);
  const label = found?.field.label ?? filter.fieldPath.join('.');
  const condition = found ? conditionOf(filter, found.field) : undefined;
  const operator = condition?.label ?? filter.operator.replaceAll('-', ' ');
  let value = '';
  if (filter.operator === 'true' || filter.operator === 'false') value = ` ${filter.operator}`;
  else if (filter.operator === 'between' && Array.isArray(filter.value)) {
    value = ` ${formatValue(filter.value[0], found?.field)} and ${formatValue(filter.value[1], found?.field)}`;
  } else if (filter.value !== undefined) value = ` ${formatValue(filter.value, found?.field)}`;
  return {
    field: found,
    scope: found?.scope,
    text: `${label} ${operator}${value}`,
    stale: condition === undefined,
  };
}
