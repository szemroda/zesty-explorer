import { describe, expect, it } from 'vitest';
import type { ModelZuid } from '../domain';
import { buildCodeVersionOptions, formattedText, versionSource } from './code-file-history';

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

describe('versionSource', () => {
  it('colors a saved source like the Code tab, without its explanations', () => {
    const articles = '6-articles01' as ModelZuid;
    const [line] = versionSource('/list.json', '{{each articles as a}}{{a.title}}{{end-each}}', {
      collections: [{ modelZuid: articles, name: 'articles', label: 'Articles' }],
      files: [],
    }).saved;

    expect(line?.tokens.map(({ text, kind, ref, hint }) => [text, kind, ref, hint])).toEqual([
      ['{{', 'delimiter', undefined, undefined],
      ['each', 'keyword', undefined, undefined],
      [' ', 'text', undefined, undefined],
      ['articles', 'collection', 'collection:6-articles01', undefined],
      [' ', 'text', undefined, undefined],
      ['as', 'keyword', undefined, undefined],
      [' ', 'text', undefined, undefined],
      ['a', 'alias', 'collection:6-articles01', undefined],
      ['}}', 'delimiter', undefined, undefined],
      ['{{', 'delimiter', undefined, undefined],
      ['a', 'alias', 'collection:6-articles01', undefined],
      ['.', 'operator', undefined, undefined],
      ['title', 'field', 'collection:6-articles01', undefined],
      ['}}', 'delimiter', undefined, undefined],
      ['{{', 'delimiter', undefined, undefined],
      ['end-each', 'keyword', undefined, undefined],
      ['}}', 'delimiter', undefined, undefined],
    ]);
  });
});

describe('formattedText', () => {
  it('lays out JSON source the way the formatted source view shows it', () => {
    expect(
      formattedText('/list.json', '[{{each items as item}}"{{item.title}}"{{end-each}}]'),
    ).toBe(
      ['[', '  {{each items as item}}', '    "{{item.title}}"', '  {{end-each}}', ']'].join('\n'),
    );
  });
});
