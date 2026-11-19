import { describe, expect, it } from 'vitest';
import type { ItemPublishing } from '../domain';
import { currentPublishings, publicationStatus } from './publication-status';

describe('publication status', () => {
  it('identifies the latest, published, and next scheduled versions independently', () => {
    const versions = [5, 7, 8].map((number) => ({ number }));
    const publishings: ItemPublishing[] = [
      { version: 5, active: true },
      { version: 8, active: false, publishAt: '2026-10-05T12:00:00Z' },
      { version: 7, active: false, publishAt: '2026-10-01T12:00:00Z' },
    ];

    expect(publicationStatus(8, versions, publishings, new Date('2026-09-23T12:00:00Z'))).toEqual({
      latestSaved: 8,
      currentlyPublished: 5,
      nextScheduled: { version: 7, publishAt: '2026-10-01T12:00:00Z' },
    });
  });

  it('keeps matching saved and published versions distinct and omits absent publication', () => {
    const now = new Date('2026-09-23T12:00:00Z');
    expect(publicationStatus(8, [{ number: 8 }], [{ version: 8, active: true }], now)).toEqual({
      latestSaved: 8,
      currentlyPublished: 8,
    });
    expect(publicationStatus(4, [{ number: 4 }], [], now)).toEqual({ latestSaved: 4 });
  });
});

describe('current publishings', () => {
  it('keeps live and upcoming records per item and drops the ones that ended', () => {
    const now = new Date('2026-09-23T12:00:00Z');
    const publishings = currentPublishings(
      [
        // Republished: the first record ended when the second one started.
        {
          itemZuid: '7-republished',
          version: 1,
          publishAt: '2026-01-01T00:00:00Z',
          unpublishAt: '2026-02-01T00:00:00Z',
        },
        { itemZuid: '7-republished', version: 3, publishAt: '2026-02-01T00:00:00Z' },
        { itemZuid: '7-republished', version: 4, publishAt: '2026-10-01T00:00:00Z' },
        {
          itemZuid: '7-taken-offline',
          version: 2,
          publishAt: '2026-01-01T00:00:00Z',
          unpublishAt: '2026-09-01T00:00:00Z',
        },
        {
          itemZuid: '7-ends-later',
          version: 5,
          publishAt: '2026-01-01T00:00:00Z',
          unpublishAt: '2026-12-01T00:00:00Z',
        },
      ],
      now,
    );

    expect([...publishings]).toEqual([
      [
        '7-republished',
        [
          { version: 3, publishAt: '2026-02-01T00:00:00Z', active: true },
          { version: 4, publishAt: '2026-10-01T00:00:00Z', active: false },
        ],
      ],
      [
        '7-ends-later',
        [
          {
            version: 5,
            publishAt: '2026-01-01T00:00:00Z',
            unpublishAt: '2026-12-01T00:00:00Z',
            active: true,
          },
        ],
      ],
    ]);
    expect(publicationStatus(4, [], publishings.get('7-republished') ?? [], now)).toEqual({
      latestSaved: 4,
      currentlyPublished: 3,
      nextScheduled: { version: 4, publishAt: '2026-10-01T00:00:00Z' },
    });
  });
});
