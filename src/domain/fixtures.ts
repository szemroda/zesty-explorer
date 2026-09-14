import type { CollectionSnapshot, ItemZuid, ModelZuid } from './types';

export const fixtureCollectionPage = {
  data: [
    {
      data: {
        title: 'First <strong>story</strong>',
        category: 'news',
        score: 12,
        featured: true,
        optional: null,
      },
      meta: {
        ZUID: '7-000000-aaaaaa',
        createdAt: '2026-01-01T12:00:00.000Z',
        updatedAt: '2026-02-01T12:00:00.000Z',
        version: 2,
        workflowStatus: 'ready',
      },
      siblings: {},
      web: { path: '/first-story/' },
    },
    {
      data: {
        title: 'Second story with a deliberately long value for popover tests',
        category: 'opinion',
        score: 0,
        featured: false,
      },
      meta: {
        ZUID: '7-000000-bbbbbb',
        createdAt: '2026-01-02T12:00:00.000Z',
        updatedAt: '2026-01-20T12:00:00.000Z',
        version: 1,
      },
      siblings: {},
      web: { path: '/second-story/' },
    },
  ],
  _meta: { totalResults: 2, page: 1, limit: 100 },
} as const;

function seededValue(index: number, seed: number): number {
  let value = (index + 1) * 2_654_435_761 + seed;
  value = Math.imul(value ^ (value >>> 16), 2_246_822_519);
  return (value ^ (value >>> 13)) >>> 0;
}

function itemZuid(prefix: string, index: number): ItemZuid {
  return `7-${prefix}-${index.toString().padStart(6, '0')}` as ItemZuid;
}

function makeSnapshot(
  id: string,
  modelZuid: string,
  items: CollectionSnapshot['items'],
): CollectionSnapshot {
  return {
    id: `snapshot-${id}`,
    instanceZuid: '8-fixture-instance',
    modelZuid: modelZuid as ModelZuid,
    state: 'latest',
    language: 'en-US',
    items,
    itemsById: new Map(items.map((item) => [item.id, item])),
    partial: false,
  };
}

export function generateRelationshipGraph(size: number, seed = 1) {
  if (!Number.isInteger(size) || size < 0 || size > 50_000) {
    throw new RangeError('Fixture graph size must be an integer from 0 to 50,000.');
  }

  const parents = Array.from({ length: size }, (_, index) => {
    const id = itemZuid('parent', index);
    return {
      id,
      fields: {
        title: `Parent ${index}`,
        childKey: `group-${(index % 100).toString().padStart(3, '0')}`,
        score: seededValue(index, seed) % 10_000,
        optional: index % 7 === 0 ? null : `value-${index}`,
      },
      metadata: {
        created: new Date(1_704_067_200_000 + index * 1_000).toISOString(),
        modified: new Date(1_704_067_200_000 + index * 2_000).toISOString(),
        version: 1,
      },
      raw: {},
    };
  });

  const children = Array.from({ length: size }, (_, index) => {
    const id = itemZuid('child', index);
    return {
      id,
      fields: {
        title: `Child ${index}`,
        parentKey: `group-${(index % 100).toString().padStart(3, '0')}`,
        active: index % 2 === 0,
      },
      metadata: {
        created: new Date(1_704_067_200_000 + index * 1_000).toISOString(),
        modified: new Date(1_704_067_200_000 + index * 2_000).toISOString(),
        version: 1,
      },
      raw: {},
    };
  });

  return {
    parents: makeSnapshot('fixture-parents', '6-fixture-parents', parents),
    children: makeSnapshot('fixture-children', '6-fixture-children', children),
  } as const;
}

const secretFieldPattern = /(^|[_.-])(app[_-]?sid|authorization|session[_-]?token)([_.-]|$)/i;

export function serializeFixture(value: unknown): string {
  const serialized = JSON.stringify(value, (key, child) => {
    if (secretFieldPattern.test(key)) {
      throw new Error('Fixture serialization refused a session token-shaped field.');
    }
    return child as unknown;
  });

  if (serialized === undefined) throw new Error('Fixture is not serializable.');
  return serialized;
}
