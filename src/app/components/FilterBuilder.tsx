import { Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  CollectionField,
  CollectionNode,
  CollectionNodeId,
  CollectionSchema,
  Scalar,
  ViewFilter,
} from '../../domain';

interface FilterBuilderProps {
  readonly label: string;
  readonly root: CollectionNode;
  readonly schemas: ReadonlyMap<CollectionNodeId, CollectionSchema>;
  readonly filters: readonly ViewFilter[];
  readonly onChange: (filters: readonly ViewFilter[]) => void;
}

interface PathChoice {
  readonly label: string;
  readonly node: CollectionNode;
  readonly path: readonly CollectionNodeId[];
}

function pathChoices(root: CollectionNode): readonly PathChoice[] {
  const choices: PathChoice[] = [];
  const visit = (
    node: CollectionNode,
    path: readonly CollectionNodeId[],
    names: readonly string[],
  ) => {
    choices.push({ node, path, label: names.join(' → ') });
    node.children.forEach((child) => visit(child, [...path, child.id], [...names, child.name]));
  };
  visit(root, [], [root.name]);
  return choices;
}

function operatorsFor(field: CollectionField | undefined): readonly ViewFilter['operator'][] {
  if (!field) return ['contains', 'equals', 'is-empty', 'is-not-empty'];
  if (field.options?.length) return ['one-of', 'is-empty'];
  if (field.kind === 'boolean') return ['true', 'false', 'is-empty'];
  if (field.kind === 'number' || field.kind === 'date') {
    return ['equals', 'not-equal', 'greater-than', 'less-than', 'between', 'is-empty'];
  }
  return ['contains', 'equals', 'starts-with', 'is-empty', 'is-not-empty'];
}

function scalarInput(value: string, field: CollectionField | undefined): Scalar {
  if (field?.kind === 'number') return Number(value);
  return value;
}

function filterValue(
  value: string,
  field: CollectionField | undefined,
  operator: ViewFilter['operator'],
): unknown {
  if (['is-empty', 'is-not-empty', 'true', 'false'].includes(operator)) return undefined;
  if (operator === 'between') {
    return value.split(',').map((part) => scalarInput(part.trim(), field));
  }
  if (operator === 'one-of') {
    const selected = value.split(',').map((part) => part.trim());
    return selected.map((part) => {
      const option = field?.options?.find((candidate) => String(candidate) === part);
      return option ?? scalarInput(part, field);
    });
  }
  return scalarInput(value, field);
}

function filterSummary(filter: ViewFilter, choices: readonly PathChoice[]): string {
  const path = choices.find((choice) => choice.path.join('/') === filter.nodePath.join('/'));
  const value = filter.value === undefined ? '' : ` ${JSON.stringify(filter.value)}`;
  return `${path?.label ?? 'Missing relationship path'} · ${filter.fieldPath.join('.')} · ${filter.operator}${value}`;
}

function filterIsInvalid(
  filter: ViewFilter,
  choices: readonly PathChoice[],
  schemas: ReadonlyMap<CollectionNodeId, CollectionSchema>,
): boolean {
  const choice = choices.find(
    (candidate) => candidate.path.join('/') === filter.nodePath.join('/'),
  );
  const fieldName = filter.fieldPath[0];
  return (
    !choice ||
    !fieldName ||
    !schemas.get(choice.node.id)?.fields.some((field) => field.name === fieldName)
  );
}

export function FilterBuilder({ label, root, schemas, filters, onChange }: FilterBuilderProps) {
  const choices = useMemo(() => pathChoices(root), [root]);
  const [path, setPath] = useState('');
  const choice = choices.find((candidate) => candidate.path.join('/') === path) ?? choices[0];
  const schema = choice ? schemas.get(choice.node.id) : undefined;
  const [fieldName, setFieldName] = useState('');
  const field =
    schema?.fields.find((candidate) => candidate.name === fieldName) ?? schema?.fields[0];
  const operators = operatorsFor(field);
  const [operator, setOperator] = useState<ViewFilter['operator']>(operators[0] ?? 'contains');
  const [value, setValue] = useState('');
  const needsValue = !['is-empty', 'is-not-empty', 'true', 'false'].includes(operator);

  function choosePath(nextPath: string) {
    setPath(nextPath);
    setFieldName('');
    const nextChoice = choices.find((candidate) => candidate.path.join('/') === nextPath);
    const nextField = nextChoice ? schemas.get(nextChoice.node.id)?.fields[0] : undefined;
    setOperator(operatorsFor(nextField)[0] ?? 'contains');
  }

  function add() {
    if (!choice || !field) return;
    const nextValue = filterValue(value, field, operator);
    if (needsValue && (value.trim() === '' || (operator === 'between' && !value.includes(',')))) {
      return;
    }
    onChange([
      ...filters,
      {
        id: crypto.randomUUID(),
        nodePath: choice.path,
        fieldPath: [field.name],
        operator,
        ...(nextValue === undefined ? {} : { value: nextValue }),
      },
    ]);
    setValue('');
  }

  return (
    <div className="filter-builder" aria-label={label}>
      <div className="filter-builder__controls">
        <label className="filter-control">
          <span>Collection</span>
          <select
            aria-label={`${label} relationship path`}
            value={path}
            onChange={(event) => choosePath(event.target.value)}
          >
            {choices.map((candidate) => (
              <option key={candidate.node.id} value={candidate.path.join('/')}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-control">
          <span>Field</span>
          <select
            aria-label={`${label} field`}
            value={field?.name ?? ''}
            onChange={(event) => {
              setFieldName(event.target.value);
              const nextField = schema?.fields.find(
                (candidate) => candidate.name === event.target.value,
              );
              setOperator(operatorsFor(nextField)[0] ?? 'contains');
            }}
          >
            {schema?.fields.map((candidate) => (
              <option key={candidate.id} value={candidate.name}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-control">
          <span>Condition</span>
          <select
            aria-label={`${label} operator`}
            value={operator}
            onChange={(event) => setOperator(event.target.value as ViewFilter['operator'])}
          >
            {operators.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate.replaceAll('-', ' ')}
              </option>
            ))}
          </select>
        </label>
        {needsValue ? (
          <label className="filter-control filter-control--value">
            <span>Value</span>
            {field?.options?.length && operator === 'one-of' ? (
              <select
                multiple
                aria-label={`${label} value`}
                value={value ? value.split(',') : []}
                onChange={(event) =>
                  setValue(
                    [...event.target.selectedOptions].map((option) => option.value).join(','),
                  )
                }
              >
                {field.options.map((option) => (
                  <option key={String(option)} value={String(option)}>
                    {String(option)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label={`${label} value`}
                value={value}
                placeholder={operator === 'between' ? 'lower, upper' : 'Enter a value'}
                inputMode={field?.kind === 'number' ? 'decimal' : undefined}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </label>
        ) : null}
        <button
          className="button button--primary filter-add"
          type="button"
          disabled={!field}
          onClick={add}
        >
          <Plus size={14} /> Add filter
        </button>
      </div>
      {filters.length > 0 ? (
        <div className="filter-chips">
          {filters.map((filter) => (
            <span
              className={
                filter.invalid || filterIsInvalid(filter, choices, schemas)
                  ? 'filter-chip filter-chip--invalid'
                  : 'filter-chip'
              }
              key={filter.id}
            >
              {filterSummary(filter, choices)}
              <button
                type="button"
                aria-label={`Remove filter ${filter.fieldPath.join('.')}`}
                onClick={() => onChange(filters.filter((candidate) => candidate.id !== filter.id))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
