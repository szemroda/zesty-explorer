import { describe, expect, it } from 'vitest';
import {
  generateRelationshipGraph,
  type CollectionField,
  type CollectionNode,
  type CollectionSchema,
} from '../domain';
import {
  addCollectionNode,
  buildRelationshipIndex,
  findNativeRelationships,
  joinRelatedItems,
  removeCollectionNode,
  renameCollectionNode,
  validateCollectionTree,
  validateRelationshipPaths,
} from './index';

const graph = generateRelationshipGraph(200);

function node(
  id: `node-${string}`,
  modelZuid: `6-${string}`,
  children: readonly CollectionNode[] = [],
): CollectionNode {
  return {
    id,
    name: id,
    reference: {
      instanceZuid: '8-fixture-instance',
      modelZuid,
      deployment: 'production',
      area: 'content',
      apiBaseUrl: 'https://8-fixture-instance.api.zesty.io/v1',
      managerBaseUrl: 'https://8-fixture-instance.manager.zesty.io',
    },
    presentation: {
      visibleColumns: [],
      columnWidths: {},
      sort: { fieldPath: ['modified'], direction: 'desc' },
      filters: [],
      freeText: '',
    },
    children,
  };
}

describe('relationship indexes', () => {
  it('indexes custom scalar paths once and preserves all matches', () => {
    const index = buildRelationshipIndex(graph.children, ['parentKey']);
    const joined = joinRelatedItems(graph.parents, index, {
      kind: 'custom',
      parentField: ['childKey'],
      childField: ['parentKey'],
    });

    expect(joined.get(graph.parents.items[0]!.id)).toHaveLength(2);
    expect(joined.get(graph.parents.items[100]!.id)).toEqual(
      joined.get(graph.parents.items[0]!.id),
    );
  });

  it('uses strict typed equality and retains unmatched parents', () => {
    const child = {
      ...graph.children,
      items: [
        { ...graph.children.items[0]!, fields: { parentKey: 7 } },
        { ...graph.children.items[1]!, fields: { parentKey: '7' } },
      ],
    };
    const parent = {
      ...graph.parents,
      items: [
        { ...graph.parents.items[0]!, fields: { childKey: 7 } },
        { ...graph.parents.items[1]!, fields: { childKey: 'missing' } },
      ],
    };
    const joined = joinRelatedItems(parent, buildRelationshipIndex(child, ['parentKey']), {
      kind: 'custom',
      parentField: ['childKey'],
      childField: ['parentKey'],
    });

    expect(joined.get(parent.items[0]!.id)).toEqual([child.items[0]!.id]);
    expect(joined.get(parent.items[1]!.id)).toEqual([]);
  });

  it('resolves native item references and proposes every matching field', () => {
    const fields: CollectionField[] = [
      {
        id: '12-author123',
        name: 'author',
        label: 'Author',
        kind: 'relationship',
        relatedModelZuid: '6-people123',
      },
      {
        id: '12-review123',
        name: 'reviewer',
        label: 'Reviewer',
        kind: 'relationship',
        relatedModelZuid: '6-people123',
      },
    ];
    const schema: CollectionSchema = { modelZuid: '6-stories12', label: 'Stories', fields };
    expect(findNativeRelationships(schema, '6-people123').map((field) => field.name)).toEqual([
      'author',
      'reviewer',
    ]);

    const parent = {
      ...graph.parents,
      items: [
        {
          ...graph.parents.items[0]!,
          fields: {
            author: { zuid: graph.children.items[0]!.id },
            reviewers: [graph.children.items[0]!.id, graph.children.items[1]!.id],
          },
        },
      ],
    };
    const nativeIndex = buildRelationshipIndex(graph.children, ['id']);
    expect(
      joinRelatedItems(parent, nativeIndex, {
        kind: 'native',
        parentField: ['reviewers'],
        targetModelZuid: '6-fixture-children',
      }).get(parent.items[0]!.id),
    ).toEqual([graph.children.items[0]!.id, graph.children.items[1]!.id]);
  });

  it('marks stale relationship paths without discarding the definition', () => {
    const validation = validateRelationshipPaths(
      { kind: 'custom', parentField: ['legacy'], childField: ['parentKey'] },
      ['title', 'childKey'],
      ['title', 'parentKey'],
    );
    expect(validation).toEqual({ valid: false, invalidPaths: ['parent.legacy'] });
  });
});

describe('collection tree operations', () => {
  it('allows duplicate collection roles while keeping node IDs unique', () => {
    const root = node('node-root', '6-root');
    const first = addCollectionNode(root, 'node-root', node('node-author', '6-people'));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = addCollectionNode(first.root, 'node-root', node('node-reviewer', '6-people'));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.root.children.map((child) => child.id)).toEqual(['node-author', 'node-reviewer']);
  });

  it('rejects cross-instance nodes, cycles, depth over five, and more than ten nodes', () => {
    const root = node('node-root', '6-root');
    const foreign = {
      ...node('node-foreign', '6-foreign'),
      reference: {
        ...node('node-foreign-copy', '6-foreign').reference,
        instanceZuid: '8-other' as const,
      },
    };
    expect(addCollectionNode(root, 'node-root', foreign)).toMatchObject({
      ok: false,
      reason: 'Every collection node must belong to the root instance and deployment.',
    });

    const cycle = node('node-child', '6-child', [root]);
    expect(addCollectionNode(root, 'node-root', cycle)).toMatchObject({ ok: false });

    const tooDeep = node('node-1', '6-one', [
      node('node-2', '6-two', [
        node('node-3', '6-three', [
          node('node-4', '6-four', [node('node-5', '6-five', [node('node-6', '6-six')])]),
        ]),
      ]),
    ]);
    expect(validateCollectionTree(tooDeep)).toMatchObject({ ok: false, reason: /five levels/i });

    const tooWide = node(
      'node-wide',
      '6-wide',
      Array.from({ length: 10 }, (_, index) => node(`node-${index}`, `6-${index}model`)),
    );
    expect(validateCollectionTree(tooWide)).toMatchObject({ ok: false, reason: /ten nodes/i });
  });

  it('renames a role and removes its complete subtree', () => {
    const root = node('node-root', '6-root', [
      node('node-child', '6-child', [node('node-grandchild', '6-grandchild')]),
    ]);
    const renamed = renameCollectionNode(root, 'node-child', 'Authors');
    expect(renamed.children[0]?.name).toBe('Authors');
    const removed = removeCollectionNode(renamed, 'node-child');
    expect(removed?.children).toEqual([]);
  });
});
