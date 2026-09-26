import { describe, expect, it } from 'vitest';
import { buildCodeVersionOptions, displayText, versionSource } from './code-file-history';

describe('buildCodeVersionOptions', () => {
  it('orders versions newest first and marks the latest saved and published ones', () => {
    const options = buildCodeVersionOptions({
      versions: [
        { number: 1, code: 'one', authorZuid: '5-author-one' },
        { number: 3, code: 'three' },
        { number: 2, code: 'two', authorZuid: '5-missing' },
      ],
      publishedVersion: 2,
      users: [{ id: '5-author-one', firstName: 'Ada', lastName: 'Keller' }],
      usersState: 'ready',
    });

    expect(
      options.map((option) => [
        option.number,
        option.latestSaved,
        option.currentlyPublished,
        option.author ?? option.authorState,
      ]),
    ).toEqual([
      [3, true, false, 'unavailable'],
      [2, false, true, 'unavailable'],
      [1, false, false, 'Ada Keller'],
    ]);
  });
});

describe('displayText', () => {
  it('lays out formatted JSON source the way the source view shows it', () => {
    const source = versionSource(
      '/list.json',
      '[{{each items as item}}"{{item.title}}"{{end-each}}]',
    );

    expect(displayText(source.saved)).toBe('[{{each items as item}}"{{item.title}}"{{end-each}}]');
    expect(displayText(source.formatted).split('\n').length).toBeGreaterThan(1);
  });
});
