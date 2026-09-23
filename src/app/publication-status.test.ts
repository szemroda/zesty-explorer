import { describe, expect, it } from 'vitest';
import type { ItemPublishing } from '../domain';
import { publicationStatus } from './publication-status';

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
