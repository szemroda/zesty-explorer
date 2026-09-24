import { describe, expect, it } from 'vitest';
import type { CollectionField } from '../domain';
import { parseFilterValue } from './filter-value';

const text: CollectionField = { id: '12-title', name: 'title', label: 'Title', kind: 'text' };
const score: CollectionField = { id: '12-score', name: 'score', label: 'Score', kind: 'number' };
const published: CollectionField = {
  id: '12-published',
  name: 'published',
  label: 'Published',
  kind: 'date',
};
const category: CollectionField = {
  id: '12-category',
  name: 'category',
  label: 'Category',
  kind: 'text',
  options: ['news', 'guide', 3],
};

describe('parseFilterValue', () => {
  it('needs no value for operators without an operand', () => {
    expect(parseFilterValue('', text, 'is-empty')).toEqual({ ok: true, value: undefined });
  });

  it('asks for a missing value', () => {
    expect(parseFilterValue('  ', text, 'contains')).toEqual({
      ok: false,
      problem: 'Enter a value.',
    });
    expect(parseFilterValue('', category, 'one-of')).toEqual({
      ok: false,
      problem: 'Choose at least one value.',
    });
  });

  it('asks for both bounds of a range', () => {
    const problem = 'Enter a lower and an upper value, separated by a comma.';
    expect(parseFilterValue('5', score, 'between')).toEqual({ ok: false, problem });
    expect(parseFilterValue('5, ', score, 'between')).toEqual({ ok: false, problem });
    expect(parseFilterValue('1, 5', score, 'between')).toEqual({ ok: true, value: [1, 5] });
  });

  it('rejects text in a number field', () => {
    expect(parseFilterValue('ten', score, 'greater-than')).toEqual({
      ok: false,
      problem: 'Enter a number.',
    });
    expect(parseFilterValue('1, x', score, 'between')).toEqual({
      ok: false,
      problem: 'Enter a number.',
    });
    expect(parseFilterValue('10', score, 'greater-than')).toEqual({ ok: true, value: 10 });
  });

  it('asks for an ISO date in a date field', () => {
    const problem = { ok: false, problem: 'Enter a date as YYYY-MM-DD.' };
    expect(parseFilterValue('not-a-date', published, 'greater-than')).toEqual(problem);
    expect(parseFilterValue('31/01/2026', published, 'greater-than')).toEqual(problem);
    expect(parseFilterValue('2026-01-31, soon', published, 'between')).toEqual(problem);
    expect(parseFilterValue('2026-01-31', published, 'greater-than')).toEqual({
      ok: true,
      value: '2026-01-31',
    });
    expect(parseFilterValue('2026-01-01, 2026-01-31 12:00:00', published, 'between')).toEqual({
      ok: true,
      value: ['2026-01-01', '2026-01-31 12:00:00'],
    });
  });

  it('keeps option values in their original type', () => {
    expect(parseFilterValue('news,3', category, 'one-of')).toEqual({
      ok: true,
      value: ['news', 3],
    });
  });
});
