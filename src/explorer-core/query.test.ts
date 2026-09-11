import { describe, expect, it } from 'vitest';
import { generateRelationshipGraph, type CollectionSnapshot, type ContentItem } from '../domain';
import {
  createExplorerGraph,
  facetValues,
  filterNodeItemIds,
  matchesFilter,
  pageItemIds,
  resolveFieldPath,
  sortItemIds,
} from './index';

function item(
  id: `7-${string}`,
  fields: Record<string, unknown>,
  modified = '2026-01-01',
): ContentItem {
  return { id, fields, metadata: { modified }, raw: { secretTechnicalValue: 'excluded' } };
}

function snapshot(items: readonly ContentItem[]): CollectionSnapshot {
  return {
    id: 'snapshot-query',
    instanceZuid: '8-query',
    modelZuid: '6-query',
    state: 'latest',
    language: 'en-US',
    items,
    itemsById: new Map(items.map((entry) => [entry.id, entry])),
    partial: false,
  };
}

const items = [
  item('7-one000', {
    title: '<p>Hello WORLD</p>',
    count: 10,
    publishedAt: '2026-02-03',
    enabled: true,
    category: 'news',
    empty: '',
    nested: { code: 'alpha' },
  }),
  item('7-two000', {
    title: 'Another story',
    count: 20,
    publishedAt: '2026-03-04',
    enabled: false,
    category: 'opinion',
    nullable: null,
  }),
  item('7-three0', { title: 'Last', count: null, category: 'news' }),
];

describe('field paths and filter operators', () => {
  it('distinguishes missing, null, scalar, structured, and invalid paths', () => {
    expect(resolveFieldPath(items[0]!, ['title']).kind).toBe('scalar');
    expect(resolveFieldPath(items[1]!, ['nullable']).kind).toBe('null');
    expect(resolveFieldPath(items[1]!, ['missing']).kind).toBe('missing');
    expect(resolveFieldPath(items[0]!, ['nested']).kind).toBe('structured');
    expect(resolveFieldPath(items[0]!, ['title', 'child']).kind).toBe('invalid');
    expect(resolveFieldPath(items[0]!, ['nested', 'code'])).toEqual({
      kind: 'scalar',
      value: 'alpha',
    });
  });

  it.each([
    ['contains', 'world', true],
    ['equals', 'hello world', true],
    ['starts-with', 'hello', true],
    ['is-empty', undefined, false],
    ['is-not-empty', undefined, true],
  ] as const)('evaluates text operator %s', (operator, value, expected) => {
    expect(matchesFilter(items[0]!, { fieldPath: ['title'], operator, value })).toBe(expected);
  });

  it('evaluates numeric, date, boolean, empty, and facet operators without coercion', () => {
    expect(
      matchesFilter(items[0]!, { fieldPath: ['count'], operator: 'greater-than', value: 5 }),
    ).toBe(true);
    expect(
      matchesFilter(items[0]!, { fieldPath: ['count'], operator: 'equals', value: '10' }),
    ).toBe(false);
    expect(
      matchesFilter(items[1]!, { fieldPath: ['count'], operator: 'between', value: [10, 20] }),
    ).toBe(true);
    expect(
      matchesFilter(items[0]!, {
        fieldPath: ['publishedAt'],
        operator: 'less-than',
        value: '2026-03-01',
      }),
    ).toBe(true);
    expect(matchesFilter(items[0]!, { fieldPath: ['enabled'], operator: 'true' })).toBe(true);
    expect(matchesFilter(items[1]!, { fieldPath: ['enabled'], operator: 'false' })).toBe(true);
    expect(
      matchesFilter(items[2]!, { fieldPath: ['count'], operator: 'not-equal', value: 10 }),
    ).toBe(false);
    expect(matchesFilter(items[1]!, { fieldPath: ['missing'], operator: 'is-empty' })).toBe(true);
    expect(
      matchesFilter(items[0]!, {
        fieldPath: ['category'],
        operator: 'one-of',
        value: ['news', 'guide'],
      }),
    ).toBe(true);
  });
});

describe('graph queries', () => {
  it('uses descendant any semantics and retains the complete related-items list', () => {
    const generated = generateRelationshipGraph(200);
    const relations = new Map(
      generated.parents.items.map((parent, index) => [
        parent.id,
        [generated.children.items[index]!.id, generated.children.items[(index + 1) % 200]!.id],
      ]),
    );
    const graph = createExplorerGraph({
      rootNodeId: 'node-root',
      snapshots: new Map([
        ['node-root', generated.parents],
        ['node-child', generated.children],
      ]),
      childrenByNode: new Map([['node-root', ['node-child']]]),
      relationshipsByChildNode: new Map([['node-child', relations]]),
    });
    const rootId = generated.parents.items[0]!.id;
    const filtered = filterNodeItemIds(
      graph,
      'node-root',
      [rootId],
      [
        {
          id: 'active-child',
          nodePath: ['node-child'],
          fieldPath: ['active'],
          operator: 'true',
        },
      ],
    );

    expect(filtered).toEqual([rootId]);
    expect(graph.relatedItemIds('node-child', rootId)).toHaveLength(2);
  });

  it('searches content fields recursively, strips HTML, and excludes technical values', () => {
    const child = snapshot([item('7-child0', { body: '<b>Needle</b>' })]);
    const root = snapshot([items[0]!, items[1]!]);
    const graph = createExplorerGraph({
      rootNodeId: 'node-root',
      snapshots: new Map([
        ['node-root', root],
        ['node-child', child],
      ]),
      childrenByNode: new Map([['node-root', ['node-child']]]),
      relationshipsByChildNode: new Map([['node-child', new Map([[items[0]!.id, ['7-child0']]])]]),
    });

    expect(
      filterNodeItemIds(
        graph,
        'node-root',
        root.items.map((entry) => entry.id),
        [],
        'needle',
      ),
    ).toEqual(['7-one000']);
    expect(
      filterNodeItemIds(
        graph,
        'node-root',
        root.items.map((entry) => entry.id),
        [],
        'excluded',
      ),
    ).toEqual([]);
  });

  it('keeps table filtering local to that node', () => {
    const graph = createExplorerGraph({
      rootNodeId: 'node-root',
      snapshots: new Map([['node-root', snapshot(items)]]),
      childrenByNode: new Map(),
      relationshipsByChildNode: new Map(),
    });
    const filtered = filterNodeItemIds(
      graph,
      'node-root',
      items.map((entry) => entry.id),
      [{ id: 'news', nodePath: [], fieldPath: ['category'], operator: 'equals', value: 'news' }],
    );
    expect(filtered).toEqual(['7-one000', '7-three0']);
    expect(graph.snapshot('node-root').items).toHaveLength(3);
  });
});

describe('sorting, facets, and pages', () => {
  it('sorts stably with nulls last in either direction', () => {
    const source = snapshot([
      item('7-a00000', { score: 2 }),
      item('7-b00000', { score: null }),
      item('7-c00000', { score: 1 }),
      item('7-d00000', { score: 2 }),
    ]);
    const ids = source.items.map((entry) => entry.id);
    expect(sortItemIds(source, ids, { fieldPath: ['score'], direction: 'asc' })).toEqual([
      '7-c00000',
      '7-a00000',
      '7-d00000',
      '7-b00000',
    ]);
    expect(sortItemIds(source, ids, { fieldPath: ['score'], direction: 'desc' }).at(-1)).toBe(
      '7-b00000',
    );
  });

  it('computes scalar facets on demand and selects page IDs', () => {
    expect(facetValues(snapshot(items), ['category'])).toEqual(['news', 'opinion']);
    expect(
      pageItemIds(
        items.map((entry) => entry.id),
        1,
        2,
      ),
    ).toEqual(['7-three0']);
  });
});
