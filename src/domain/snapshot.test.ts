import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  decodeCollectionPage,
  decodeItemVersions,
  fixtureCollectionPage,
  generateRelationshipGraph,
  serializeFixture,
} from './index';

describe('collection snapshot contracts', () => {
  it('decodes content fields separately from technical metadata', () => {
    const decoded = decodeCollectionPage(fixtureCollectionPage);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isLeft(decoded)) return;

    expect(decoded.right.items[0]).toEqual({
      id: '7-000000-aaaaaa',
      fields: {
        title: 'First <strong>story</strong>',
        category: 'news',
        score: 12,
        featured: true,
        optional: null,
      },
      metadata: {
        created: '2026-01-01T12:00:00.000Z',
        modified: '2026-02-01T12:00:00.000Z',
        version: 2,
        workflowStatus: 'ready',
      },
      raw: fixtureCollectionPage.data[0],
    });
    expect(decoded.right.totalResults).toBe(2);
  });

  it('returns a typed decoding error for malformed API data', () => {
    const decoded = decodeCollectionPage({
      data: [{ data: { secret: 'private-content-value' }, meta: { ZUID: 4 } }],
      _meta: {},
    });
    expect(Either.isLeft(decoded)).toBe(true);
    if (Either.isRight(decoded)) return;
    expect(decoded.left.kind).toBe('decoding');
    expect(decoded.left.diagnostic?.issues?.[0]).toEqual({
      path: '$.data[0].meta.ZUID',
      expected: 'string',
      received: 'number',
    });
    expect(JSON.stringify(decoded.left)).not.toContain('private-content-value');
  });

  it('accepts the official collection metadata shape without a page field', () => {
    const decoded = decodeCollectionPage({
      ...fixtureCollectionPage,
      _meta: { totalResults: 202, start: 100, offset: 100, limit: 100 },
    });
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isLeft(decoded)) return;
    expect(decoded.right.page).toBe(2);
  });

  it('rejects malformed item ZUIDs before branding them', () => {
    const decoded = decodeCollectionPage({
      ...fixtureCollectionPage,
      data: [
        {
          ...fixtureCollectionPage.data[0],
          meta: { ...fixtureCollectionPage.data[0].meta, ZUID: 'wrong' },
        },
      ],
    });
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it('keeps version history usable when an author is null', () => {
    const decoded = decodeItemVersions({
      data: [
        {
          data: { title: 'Saved title' },
          meta: {
            ZUID: '7-versioned-item',
            createdAt: '2026-01-01T12:00:00.000Z',
            updatedAt: '2026-01-02T12:00:00.000Z',
            version: 1,
          },
          web: {
            versionZUID: '9-version-one',
            createdAt: '2026-01-02T12:00:00.000Z',
            createdByUserZUID: null,
          },
        },
      ],
    });

    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isLeft(decoded)) return;
    expect(decoded.right[0]).toMatchObject({
      number: 1,
      savedAt: '2026-01-02T12:00:00.000Z',
      item: { fields: { title: 'Saved title' } },
    });
    expect(decoded.right[0]).not.toHaveProperty('authorZuid');
  });

  it('generates deterministic relationship graphs at requested sizes', () => {
    const first = generateRelationshipGraph(1_000, 17);
    const second = generateRelationshipGraph(1_000, 17);
    expect(second).toEqual(first);
    expect(first.parents.items).toHaveLength(1_000);
    expect(first.children.items).toHaveLength(1_000);
    expect(first.parents.items[999]?.fields.childKey).toBe('group-099');
  });

  it('rejects fixture data with token-shaped fields', () => {
    expect(() => serializeFixture({ APP_SID: 'secret' })).toThrow(/session token/i);
    expect(serializeFixture(fixtureCollectionPage)).not.toMatch(/APP_SID|authorization/i);
  });
});
