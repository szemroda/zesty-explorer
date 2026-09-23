import { describe, expect, it } from 'vitest';
import type { ContentItem, ContentItemVersion, InstanceUser, ItemPublishing } from '../domain';
import { buildVersionPreviewOptions, matchesVersionPreviewOption } from './item-version-preview';

function item(number: number, title: string): ContentItem {
  return {
    id: '7-versioned-item',
    fields: { title },
    metadata: { version: number, modified: `2026-09-${20 + number}T10:00:00.000Z` },
    raw: { data: { title }, meta: { version: number } },
  };
}

const versions: readonly ContentItemVersion[] = [
  {
    number: 2,
    savedAt: '2026-09-22T10:00:00.000Z',
    authorZuid: '5-author-two',
    item: item(2, 'Version two'),
  },
  {
    number: 3,
    savedAt: '2026-09-23T10:00:00.000Z',
    authorZuid: '5-author-three',
    item: item(3, 'Version three'),
  },
];

const publishings: readonly ItemPublishing[] = [
  { version: 2, active: true },
  {
    version: 3,
    active: false,
    publishAt: '2026-10-03T12:00:00.000Z',
  },
  {
    version: 3,
    active: false,
    publishAt: '2026-10-01T12:00:00.000Z',
  },
  {
    version: 3,
    active: false,
    publishAt: '2026-10-02T12:00:00.000Z',
    unpublishAt: '2026-10-04T12:00:00.000Z',
  },
  {
    version: 1,
    active: false,
    publishAt: '2026-01-01T12:00:00.000Z',
  },
];

const users: readonly InstanceUser[] = [
  { id: '5-author-two', firstName: 'Taylor', lastName: 'Ng', email: 't@example.test' },
  { id: '5-author-three', email: 'editor@example.test' },
];

describe('item version preview', () => {
  it('builds one enriched, descending history and preserves the current table version', () => {
    const options = buildVersionPreviewOptions({
      currentItem: item(1, 'Current table content'),
      versions,
      publishings,
      users,
      usersState: 'ready',
      now: new Date('2026-09-24T12:00:00.000Z'),
    });

    expect(options.map((option) => option.number)).toEqual([3, 2, 1]);
    expect(options[0]).toMatchObject({
      number: 3,
      author: 'editor@example.test',
      authorState: 'resolved',
      latestSaved: true,
      currentlyPublished: false,
      scheduledAt: '2026-10-01T12:00:00.000Z',
      additionalSchedules: 2,
      currentInView: false,
    });
    expect(options[1]).toMatchObject({
      number: 2,
      author: 'Taylor Ng',
      currentlyPublished: true,
      latestSaved: false,
    });
    expect(options[2]).toMatchObject({
      number: 1,
      savedAt: '2026-09-21T10:00:00.000Z',
      currentInView: true,
      authorState: 'unavailable',
      item: { fields: { title: 'Current table content' } },
    });
  });

  it('keeps the version response authoritative when the table row has the same version number', () => {
    const options = buildVersionPreviewOptions({
      currentItem: item(3, 'Current table content'),
      versions: [versions[1]!],
      publishings: [],
      users,
      usersState: 'ready',
      now: new Date('2026-09-24T12:00:00.000Z'),
    });

    expect(options[0]).toMatchObject({
      savedAt: '2026-09-23T10:00:00.000Z',
      author: 'editor@example.test',
      item: { fields: { title: 'Version three' } },
      currentInView: true,
    });
  });

  it('marks unresolved authors as loading and searches numbers, authors, and statuses', () => {
    const [option] = buildVersionPreviewOptions({
      currentItem: item(3, 'Version three'),
      versions: [versions[1]!],
      publishings: [publishings[1]!],
      users: [],
      usersState: 'loading',
      now: new Date('2026-09-24T12:00:00.000Z'),
    });

    expect(option?.authorState).toBe('loading');
    expect(matchesVersionPreviewOption(option!, 'version 3')).toBe(true);
    expect(matchesVersionPreviewOption(option!, 'latest')).toBe(true);
    expect(matchesVersionPreviewOption(option!, 'scheduled')).toBe(true);
    expect(matchesVersionPreviewOption(option!, 'published')).toBe(false);
    expect(matchesVersionPreviewOption({ ...option!, author: 'Morgan Lee' }, 'morgan')).toBe(true);
  });

  it('uses email when only part of an author name is available', () => {
    const [option] = buildVersionPreviewOptions({
      currentItem: item(3, 'Version three'),
      versions: [versions[1]!],
      publishings: [],
      users: [{ id: '5-author-three', firstName: 'Morgan', email: 'editor@example.test' }],
      usersState: 'ready',
      now: new Date('2026-09-24T12:00:00.000Z'),
    });

    expect(option?.author).toBe('editor@example.test');
  });
});
