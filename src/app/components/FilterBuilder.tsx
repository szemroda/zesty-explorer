import { Plus, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type {
  CollectionField,
  CollectionNode,
  CollectionNodeId,
  CollectionSchema,
  ViewFilter,
} from '../../domain';
import { operatorNeedsValue, parseFilterValue } from '../filter-value';
import { useFieldProblem } from '../hooks/useFieldProblem';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Field } from './ui/field';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

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

const ROOT_PATH_VALUE = '$root';

function pathValue(path: readonly CollectionNodeId[]): string {
  return path.length === 0 ? ROOT_PATH_VALUE : path.join('/');
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
  const choice = choices.find((candidate) => pathValue(candidate.path) === path) ?? choices[0];
  const schema = choice ? schemas.get(choice.node.id) : undefined;
  const [fieldName, setFieldName] = useState('');
  const field =
    schema?.fields.find((candidate) => candidate.name === fieldName) ?? schema?.fields[0];
  const operators = operatorsFor(field);
  const [operator, setOperator] = useState<ViewFilter['operator']>(operators[0] ?? 'contains');
  const [value, setValue] = useState('');
  const valueControl = useRef<HTMLElement | null>(null);
  const problem = useFieldProblem({ value: valueControl });
  const needsValue = operatorNeedsValue(operator);

  function changeValue(nextValue: string) {
    setValue(nextValue);
    problem.clear();
  }

  function changeOperator(nextOperator: ViewFilter['operator']) {
    setOperator(nextOperator);
    problem.clear();
  }

  // The value control is an input or, for option lists, a select trigger.
  function setValueControl(element: HTMLElement | null) {
    valueControl.current = element;
  }

  function choosePath(nextPath: string) {
    setPath(nextPath);
    setFieldName('');
    const nextChoice = choices.find((candidate) => pathValue(candidate.path) === nextPath);
    const nextField = nextChoice ? schemas.get(nextChoice.node.id)?.fields[0] : undefined;
    changeOperator(operatorsFor(nextField)[0] ?? 'contains');
  }

  function add() {
    if (!choice || !field) return;
    const parsed = parseFilterValue(value, field, operator);
    if (!parsed.ok) {
      problem.report('value', parsed.problem);
      return;
    }
    onChange([
      ...filters,
      {
        id: crypto.randomUUID(),
        nodePath: choice.path,
        fieldPath: [field.name],
        operator,
        ...(parsed.value === undefined ? {} : { value: parsed.value }),
      },
    ]);
    changeValue('');
  }

  return (
    <div className="min-w-0 p-3.5" aria-label={label}>
      <div className="grid grid-cols-[minmax(140px,1.2fr)_minmax(130px,1fr)_minmax(120px,.85fr)_minmax(160px,1.3fr)_auto] items-start gap-2.5 max-[1260px]:grid-cols-3">
        <Label className="grid gap-1.5">
          <span>Collection</span>
          <Select
            items={choices.map((candidate) => ({
              label: candidate.label,
              value: pathValue(candidate.path),
            }))}
            value={path || ROOT_PATH_VALUE}
            onValueChange={(nextPath) => {
              if (nextPath !== null) choosePath(nextPath);
            }}
          >
            <SelectTrigger className="w-full" aria-label={`${label} relationship path`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((candidate) => (
                <SelectItem key={candidate.node.id} value={pathValue(candidate.path)}>
                  {candidate.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
        <Label className="grid gap-1.5">
          <span>Field</span>
          <Select
            items={schema?.fields.map((candidate) => ({
              label: candidate.label,
              value: candidate.name,
            }))}
            value={field?.name ?? ''}
            onValueChange={(nextFieldName) => {
              if (nextFieldName === null) return;
              setFieldName(nextFieldName);
              const nextField = schema?.fields.find(
                (candidate) => candidate.name === nextFieldName,
              );
              changeOperator(operatorsFor(nextField)[0] ?? 'contains');
            }}
          >
            <SelectTrigger className="w-full" aria-label={`${label} field`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {schema?.fields.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.name}>
                  {candidate.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
        <Label className="grid gap-1.5">
          <span>Condition</span>
          <Select
            items={operators.map((candidate) => ({
              label: candidate.replaceAll('-', ' '),
              value: candidate,
            }))}
            value={operator}
            onValueChange={(nextOperator) => {
              if (nextOperator !== null) changeOperator(nextOperator);
            }}
          >
            <SelectTrigger className="w-full" aria-label={`${label} operator`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operators.map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {candidate.replaceAll('-', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
        {needsValue ? (
          <Field render={<Label className="grid gap-1.5" />} error={problem.messageFor('value')}>
            <span>Value</span>
            {field?.options?.length && operator === 'one-of' ? (
              <Select
                items={field.options.map((option) => ({
                  label: String(option),
                  value: String(option),
                }))}
                multiple
                value={value ? value.split(',') : []}
                onValueChange={(selected) => changeValue(selected.join(','))}
              >
                <SelectTrigger
                  ref={setValueControl}
                  className="w-full"
                  aria-label={`${label} value`}
                >
                  <SelectValue>
                    {(selected: string[]) =>
                      selected.length === 0
                        ? 'Choose values'
                        : selected.length === 1
                          ? selected[0]
                          : `${selected.length} selected`
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((option) => (
                    <SelectItem key={String(option)} value={String(option)}>
                      {String(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                ref={setValueControl}
                aria-label={`${label} value`}
                value={value}
                placeholder={operator === 'between' ? 'lower, upper' : 'Enter a value'}
                inputMode={field?.kind === 'number' ? 'decimal' : undefined}
                onChange={(event) => changeValue(event.target.value)}
              />
            )}
          </Field>
        ) : null}
        {/* The top margin lines the button up with the inputs below their labels. */}
        <Button
          className="max-[1260px]:justify-self-start min-[1261px]:mt-5.5"
          type="button"
          disabled={!field}
          onClick={add}
        >
          <Plus size={14} /> Add filter
        </Button>
      </div>
      {filters.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {filters.map((filter) => (
            <Badge
              variant={
                filter.invalid || filterIsInvalid(filter, choices, schemas)
                  ? 'destructive'
                  : 'outline'
              }
              className="gap-1.5 py-1 pr-1 pl-2 font-medium"
              key={filter.id}
            >
              {filterSummary(filter, choices)}
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-5 rounded-full"
                type="button"
                aria-label={`Remove filter ${filter.fieldPath.join('.')}`}
                onClick={() => onChange(filters.filter((candidate) => candidate.id !== filter.id))}
              >
                <X size={12} />
              </Button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
