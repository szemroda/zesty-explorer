import { describe, expect, it } from 'vitest';
import type {
  CollectionField,
  CollectionNode,
  CollectionSchema,
  ContentItem,
  ItemZuid,
} from '../domain';
import { matchesFilter } from '../explorer-core';
import { collectionNode } from '../test/fixtures';
import {
  describeFilter,
  draftFromFilter,
  emptyDraft,
  filterFields,
  filterFromDraft,
  filtersField,
  findFilterField,
  optionCounts,
  parseScalar,
} from './filter-fields';

const blocks: CollectionNode = { ...collectionNode('node-blocks', '6-blocks'), name: 'Blocks' };
const sections: CollectionNode = {
  ...collectionNode('node-sections', '6-sections', [blocks]),
  name: 'Sections',
};
const root: CollectionNode = {
  ...collectionNode('node-root', '6-articles', [sections]),
  name: 'Articles',
};
const schemas = new Map<CollectionNode['id'], CollectionSchema>([
  [
    root.id,
    {
      modelZuid: '6-articles',
      label: 'Articles',
      fields: [
        { id: '12-active', name: 'active', label: 'Active', kind: 'boolean' },
        { id: '12-score', name: 'score', label: 'Score', kind: 'number' },
        {
          id: '12-state',
          name: 'state',
          label: 'State',
          kind: 'text',
          options: [
            { value: 'draft', label: 'Draft' },
            { value: 'review', label: 'In review' },
          ],
        },
        {
          id: '12-featured',
          name: 'featured',
          label: 'Featured',
          kind: 'boolean',
          options: [
            { value: '0', label: 'No' },
            { value: '1', label: 'Yes' },
          ],
        },
      ],
    },
  ],
  [sections.id, { modelZuid: '6-sections', label: 'Sections', fields: [] }],
  [
    blocks.id,
    {
      modelZuid: '6-blocks',
      label: 'Blocks',
      fields: [
        {
          id: '12-type',
          name: 'type',
          label: 'Type',
          kind: 'text',
          options: [
            { value: 'hero', label: 'hero' },
            { value: 'cta', label: 'cta' },
          ],
        },
      ],
    },
  ],
]);
const fields = filterFields(root, schemas);
const [active, score, state, featured] = fields.groups[0]!.items;

function item(id: string, values: ContentItem['fields']): ContentItem {
  return { id: id as ItemZuid, fields: values, metadata: {}, raw: {} };
}

describe('filter fields', () => {
  it('groups own fields first and names descendants by their node path', () => {
    expect(
      fields.groups.map((group) => [group.label, group.items.map((f) => f.field.label)]),
    ).toEqual([
      ['Articles', ['Active', 'Score', 'State', 'Featured']],
      ['Sections › Blocks', ['Type']],
    ]);
  });

  it('writes and reads back a descendant option filter', () => {
    const type = fields.groups[1]!.items[0]!;
    const result = filterFromDraft(
      { ...emptyDraft(type), options: ['hero', 'cta'] },
      type,
      'filter-1',
    );
    expect(result).toEqual({
      ok: true,
      filter: {
        id: 'filter-1',
        nodePath: ['node-sections', 'node-blocks'],
        fieldPath: ['type'],
        operator: 'one-of',
        value: ['hero', 'cta'],
      },
    });
    if (!result.ok) return;
    expect(describeFilter(result.filter, fields)).toEqual({
      field: type,
      scope: 'Sections › Blocks',
      text: 'Type is hero, cta',
      stale: false,
    });
    expect(draftFromFilter(result.filter).options).toEqual(['hero', 'cta']);
  });

  it('describes own boolean and range filters in plain words', () => {
    const isFalse = { id: 'a', nodePath: [], fieldPath: ['active'], operator: 'false' } as const;
    const range = {
      id: 's',
      nodePath: [],
      fieldPath: ['score'],
      operator: 'between',
      value: [10, 20],
    } as const;
    expect(describeFilter(isFalse, fields).text).toBe('Active is false');
    expect(describeFilter(range, fields).text).toBe('Score between 10 and 20');
  });

  it('counts loaded items per option, including options no item uses', () => {
    const items = [
      item('7-a', { state: 'review', active: true }),
      item('7-b', { state: 'review', active: false }),
      item('7-c', { state: 'archived', active: 'yes' }),
      item('7-d', {}),
    ];
    expect(optionCounts(state!.field, items)).toEqual(
      new Map([
        ['draft', 0],
        ['review', 2],
      ]),
    );
    expect(optionCounts(active!.field, items)).toEqual(
      new Map([
        ['true', 1],
        ['false', 1],
      ]),
    );
  });

  it('counts and matches string options against the numbers items store', () => {
    const items = [
      item('7-a', { featured: 1 }),
      item('7-b', { featured: 0 }),
      item('7-c', { featured: 1 }),
    ];
    expect(optionCounts(featured!.field, items)).toEqual(
      new Map([
        ['0', 1],
        ['1', 2],
      ]),
    );
    const result = filterFromDraft({ ...emptyDraft(featured), options: ['1'] }, featured!, 'f');
    if (!result.ok) throw new Error(result.problem);
    expect(
      items.filter((entry) => matchesFilter(entry, result.filter)).map(({ id }) => id),
    ).toEqual(['7-a', '7-c']);
  });

  it('counts a value the filter engine finds in the item metadata', () => {
    const fromMetadata = { ...item('7-a', {}), metadata: { state: 'draft' } };
    expect(optionCounts(state!.field, [fromMetadata]).get('draft')).toBe(1);
  });

  it('describes option filters with the schema labels', () => {
    const result = filterFromDraft(
      { ...emptyDraft(state), options: ['review', 'draft'] },
      state!,
      'f',
    );
    expect(result.ok && describeFilter(result.filter, fields).text).toBe(
      'State is Draft, In review',
    );
  });

  it('saves one boolean choice as its own operator and both as one-of', () => {
    const one = filterFromDraft({ ...emptyDraft(active), options: ['false'] }, active!, 'b');
    const both = filterFromDraft(
      { ...emptyDraft(active), options: ['true', 'false'] },
      active!,
      'b',
    );
    expect(one.ok && one.filter.operator).toBe('false');
    expect(both.ok && [both.filter.operator, both.filter.value]).toEqual(['one-of', [true, false]]);
    if (one.ok) expect(draftFromFilter(one.filter).options).toEqual(['false']);
  });

  it('asks for each missing bound of a range by name', () => {
    const draft = { ...emptyDraft(score), condition: 'between' } as const;
    expect(filterFromDraft({ ...draft, upper: '5' }, score!, 'r')).toEqual({
      ok: false,
      problem: 'Enter a lower value.',
      input: 'value',
    });
    expect(filterFromDraft({ ...draft, value: '1' }, score!, 'r')).toEqual({
      ok: false,
      problem: 'Enter an upper value.',
      input: 'upper',
    });
    expect(filterFromDraft({ ...draft, value: '1', upper: 'x' }, score!, 'r')).toEqual({
      ok: false,
      problem: 'Enter a number.',
      input: 'upper',
    });
    const range = filterFromDraft({ ...draft, value: '1', upper: ' 5 ' }, score!, 'r');
    expect(range.ok && range.filter.value).toEqual([1, 5]);
  });

  it('marks a filter on a field that left the view as stale', () => {
    const filter = { id: 'x', nodePath: [], fieldPath: ['gone'], operator: 'is-empty' } as const;
    expect(describeFilter(filter, fields).stale).toBe(true);
  });

  it('matches a filter to a field only by its whole field path', () => {
    const inside = {
      id: 'x',
      nodePath: [],
      fieldPath: ['state', 'caption'],
      operator: 'contains',
      value: 'a',
    } as const;
    expect(findFilterField(fields, inside)).toBeUndefined();
    expect(filtersField(inside, state!)).toBe(false);
    expect(describeFilter(inside, fields)).toEqual({
      field: undefined,
      scope: undefined,
      text: 'state.caption contains “a”',
      stale: true,
    });
  });

  it('marks a filter whose condition its field does not offer as stale', () => {
    const filter = {
      id: 'x',
      nodePath: [],
      fieldPath: ['score'],
      operator: 'contains',
      value: 'a',
    } as const;
    expect(describeFilter(filter, fields).stale).toBe(true);
  });
});

describe('parseScalar', () => {
  const text: CollectionField = { id: '12-title', name: 'title', label: 'Title', kind: 'text' };
  const published: CollectionField = {
    id: '12-published',
    name: 'published',
    label: 'Published',
    kind: 'date',
  };

  it('asks for a missing value', () => {
    expect(parseScalar('  ', text)).toEqual({ ok: false, problem: 'Enter a value.' });
  });

  it('reads a number field as a number', () => {
    expect(parseScalar('ten', score!.field)).toEqual({ ok: false, problem: 'Enter a number.' });
    expect(parseScalar(' 10 ', score!.field)).toEqual({ ok: true, value: 10 });
  });

  it('asks for an ISO date in a date field', () => {
    const problem = { ok: false, problem: 'Enter a date as YYYY-MM-DD.' };
    expect(parseScalar('not-a-date', published)).toEqual(problem);
    expect(parseScalar('31/01/2026', published)).toEqual(problem);
    expect(parseScalar('2026-01-31 12:00:00', published)).toEqual({
      ok: true,
      value: '2026-01-31 12:00:00',
    });
  });
});
