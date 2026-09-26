import { describe, expect, it } from 'vitest';
import type { ContentItem } from '../domain';
import {
  collapseUnchanged,
  compareContentItems,
  diffRawJson,
  diffText,
  diffTextSideBySide,
  resolveVersionPair,
  type NumberedLine,
  type TextFragment,
} from './item-version-comparison';
import type { VersionPreviewOption } from './item-version-preview';

function item(
  fields: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): ContentItem {
  return { id: '7-item', fields, metadata, raw: { data: fields, meta: metadata } };
}

function option(number: number): VersionPreviewOption {
  return {
    number,
    item: item({}, { version: number }),
    authorState: 'unavailable',
    latestSaved: false,
    currentlyPublished: false,
    additionalSchedules: 0,
    currentInView: false,
  };
}

function lineText(line: NumberedLine | undefined): string | undefined {
  return line?.fragments.map((fragment) => fragment.text).join('');
}

function highlighted(fragments: readonly TextFragment[]): string[] {
  return fragments.filter((fragment) => fragment.highlighted).map((fragment) => fragment.text);
}

describe('compareContentItems', () => {
  it('lists only differing content fields and technical metadata as separate groups', () => {
    const comparison = compareContentItems(
      item({ title: 'Same', author: 'john smith' }, { version: 2, zuid: '7-a' }),
      item({ title: 'Same', author: 'sdf' }, { version: 3, zuid: '7-a' }),
    );

    expect(comparison.fields).toEqual([
      {
        name: 'author',
        changes: [{ kind: 'changed', path: [], before: 'john smith', after: 'sdf' }],
      },
    ]);
    expect(comparison.metadata).toEqual([
      { name: 'version', changes: [{ kind: 'changed', path: [], before: 2, after: 3 }] },
    ]);
  });

  it('locates nested changes and compares array entries by position', () => {
    const comparison = compareContentItems(
      item({ seo: { title: 'Old', tags: ['a', 'b'] } }),
      item({ seo: { title: 'New', tags: ['b', 'a', 'c'] } }),
    );

    expect(comparison.fields).toEqual([
      {
        name: 'seo',
        changes: [
          { kind: 'changed', path: ['title'], before: 'Old', after: 'New' },
          { kind: 'changed', path: ['tags', 0], before: 'a', after: 'b' },
          { kind: 'changed', path: ['tags', 1], before: 'b', after: 'a' },
          { kind: 'added', path: ['tags', 2], after: 'c' },
        ],
      },
    ]);
  });

  it('keeps missing fields, null, empty text, and different JSON types distinct', () => {
    const comparison = compareContentItems(
      item({ removed: 'x', nullable: null, empty: '', count: 2 }),
      item({ nullable: '', empty: null, count: '2', added: null }),
    );

    expect(comparison.fields).toEqual([
      { name: 'removed', changes: [{ kind: 'removed', path: [], before: 'x' }] },
      { name: 'nullable', changes: [{ kind: 'changed', path: [], before: null, after: '' }] },
      { name: 'empty', changes: [{ kind: 'changed', path: [], before: '', after: null }] },
      { name: 'count', changes: [{ kind: 'changed', path: [], before: 2, after: '2' }] },
      { name: 'added', changes: [{ kind: 'added', path: [], after: null }] },
    ]);
  });
});

describe('diffText', () => {
  it('highlights changed words within a changed line', () => {
    const [removed, added] = diffText('The quick fox', 'The slow fox');

    expect(removed?.kind).toBe('removed');
    expect(highlighted(removed!.fragments)).toEqual(['quick']);
    expect(added?.kind).toBe('added');
    expect(highlighted(added!.fragments)).toEqual(['slow']);
  });

  it('does not highlight fragments when the lines share no words', () => {
    const lines = diffText('john smith', 'sdf');

    expect(lines.map((line) => line.kind)).toEqual(['removed', 'added']);
    expect(lines.flatMap((line) => highlighted(line.fragments))).toEqual([]);
  });

  it('keeps unchanged lines of multi-line source text as context', () => {
    const lines = diffText(
      '<p>One</p>\n<p>Two</p>\n<p>Three</p>',
      '<p>One</p>\n<p>2</p>\n<p>Three</p>',
    );

    expect(lines.map((line) => line.kind)).toEqual(['unchanged', 'removed', 'added', 'unchanged']);
    expect(highlighted(lines[1]!.fragments)).toEqual(['Two']);
    expect(highlighted(lines[2]!.fragments)).toEqual(['2']);
  });

  it('shows too scattered a rewrite as replaced lines without fragment highlights', () => {
    const text = (suffix: string) =>
      Array.from({ length: 1_500 }, (_, index) => `line ${index} ${suffix}`).join('\n');

    const lines = diffText(text('old'), text('new'));

    expect(lines).toHaveLength(3_000);
    expect(lines.flatMap((line) => highlighted(line.fragments))).toEqual([]);
  });
});

describe('diffRawJson', () => {
  it('ignores property order and formatting', () => {
    const rows = diffRawJson({ b: 1, a: { d: 2, c: 3 } }, { a: { c: 3, d: 2 }, b: 1 });

    expect(rows.some((row) => row.changed)).toBe(false);
  });

  it('aligns a sibling addition without marking the neighbour whose trailing comma moved', () => {
    const rows = diffRawJson({ a: 1 }, { a: 1, b: 2 });

    expect(
      rows.map((row) => [
        row.before?.number,
        lineText(row.before),
        row.after?.number,
        lineText(row.after),
        row.changed,
      ]),
    ).toEqual([
      [1, '{', 1, '{', false],
      [2, '  "a": 1', 2, '  "a": 1,', false],
      [undefined, undefined, 3, '  "b": 2', true],
      [3, '}', 4, '}', false],
    ]);
  });

  it('compares array entries by position, like Fields', () => {
    const rows = diffRawJson({ list: [1, 2, 3] }, { list: [3, 1, 2] });
    const changed = rows.filter((row) => row.changed);

    expect(changed.map((row) => lineText(row.before))).toEqual(['    1,', '    2,', '    3']);
    expect(changed.map((row) => lineText(row.after))).toEqual(['    3,', '    1,', '    2']);
  });

  it('pairs a changed line side by side with its changed fragment highlighted', () => {
    const rows = diffRawJson({ version: 2 }, { version: 3 });
    const changed = rows.find((row) => row.changed);

    expect(highlighted(changed!.before!.fragments)).toEqual(['2']);
    expect(highlighted(changed!.after!.fragments)).toEqual(['3']);
  });
});

describe('diffTextSideBySide', () => {
  it('aligns unchanged lines and pairs a changed line with its changed words', () => {
    const rows = diffTextSideBySide('a\nlimit 10\nz', 'a\nlimit 20\nnew\nz');

    expect(rows.map((row) => [row.before?.number, row.after?.number, row.changed])).toEqual([
      [1, 1, false],
      [2, 2, true],
      [undefined, 3, true],
      [3, 4, false],
    ]);
    expect(highlighted(rows[1]!.before!.fragments)).toEqual(['10']);
    expect(highlighted(rows[1]!.after!.fragments)).toEqual(['20']);
  });
});

describe('collapseUnchanged', () => {
  it('hides long unchanged runs away from changes and keeps nearby context', () => {
    const rows = [true, false, false, false, false, false, false, false, true];
    const sections = collapseUnchanged(rows, (changed) => changed, 1);

    expect(sections.map((section) => [section.hidden, section.rows.length])).toEqual([
      [false, 2],
      [true, 5],
      [false, 2],
    ]);
  });

  it('keeps short unchanged runs visible', () => {
    const rows = [true, false, false, false, false, true];
    const sections = collapseUnchanged(rows, (changed) => changed, 1);

    expect(sections).toEqual([{ hidden: false, rows }]);
  });
});

describe('resolveVersionPair', () => {
  const options = [option(4), option(3), option(2), option(1)];

  it('compares the previewed version with the save before it', () => {
    const pair = resolveVersionPair(options, 3, undefined);

    expect([pair?.before.number, pair?.after.number]).toEqual([2, 3]);
  });

  it('compares the two oldest versions when the oldest is previewed', () => {
    const pair = resolveVersionPair(options, 1, undefined);

    expect([pair?.before.number, pair?.after.number]).toEqual([1, 2]);
  });

  it('uses a chosen pair while both versions exist in older-to-newer order', () => {
    expect(resolveVersionPair(options, 3, { before: 1, after: 4 })).toMatchObject({
      before: { number: 1 },
      after: { number: 4 },
    });
    expect(resolveVersionPair(options, 3, { before: 4, after: 1 })).toMatchObject({
      before: { number: 2 },
      after: { number: 3 },
    });
  });

  it('has nothing to compare with fewer than two versions', () => {
    expect(resolveVersionPair([option(1)], 1, undefined)).toBeUndefined();
  });
});
