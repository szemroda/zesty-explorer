import { describe, expect, it } from 'vitest';
import type { CollectionSchema, ContentItem, ModelZuid } from '../domain';
import {
  checkImport,
  fileLines,
  importableRowsCsv,
  markdownReport,
  matchesLineQuery,
  needsAttention,
  parseCsv,
  parseLineQuery,
  problemRowsCsv,
  summarize,
  takesAnyLine,
  zestyPathPart,
  type ImportCheck,
} from './index';

const countries = '6-countries' as ModelZuid;
const unreadable = String.fromCodePoint(0xfffd);

const schema: CollectionSchema = {
  modelZuid: '6-cities',
  label: 'Cities',
  fields: [
    { id: '12-title', name: 'title', label: 'Title', kind: 'text', required: true },
    { id: '12-rating', name: 'rating', label: 'Rating', kind: 'number' },
    {
      id: '12-country',
      name: 'country',
      label: 'Country',
      kind: 'relationship',
      relatedModelZuid: countries,
    },
    { id: '12-body', name: 'body', label: 'Body', kind: 'text' },
  ],
};

const existingItems: readonly ContentItem[] = [
  { id: '7-city-munich', fields: {}, metadata: {}, raw: { web: { pathPart: 'munich' } } },
  {
    id: '7-city-paris-texas',
    fields: {},
    metadata: {},
    raw: { web: { pathPart: 'paris', parentZUID: '7-country-us' } },
  },
];

const cities = [
  'title,path,rating,country,body,internal_id,body',
  'Berlin East,Berlin East,4.5,7-country-de,draft,101,"Quiet, green"',
  'Berlin East again,berlin-east,4,7-country-de,,102,Duplicate',
  ',hamburg,3,7-country-de,,103,No title',
  'Munich,Munich,5,7-country-de,,104,Already there',
  'Paris,paris,4,France,,105,"She said ""oui"", twice"',
  'Lyon,lyon,4,7-country-xx,,106,Unknown country',
  `K${unreadable}ln,koln,"4,5",7-country-de,,107,Cathedral`,
  ',,,,,,',
  'Dresden,dresden,4,7-country-de,,108,"Baroque',
  'and rebuilt"',
  'Leipzig,leipzig,n/a,Germany,,109,"Line one',
  'line two"',
].join('\n');

function check(csv = cities, collection = schema, zestyDataComplete = true): ImportCheck {
  return checkImport({
    fileName: 'cities.csv',
    parsed: parseCsv(csv),
    schema: collection,
    modelType: 'pageset',
    existingItems,
    relatedItems: new Map([[countries, new Set(['7-country-de', '7-country-fr'])]]),
    zestyDataComplete,
  });
}

describe('checkImport', () => {
  it('predicts the outcome of each row of a pageset', () => {
    const result = check();

    expect(result.rows.map((row) => row.outcome)).toEqual([
      'created',
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'at-risk',
      'created',
      'rejected',
    ]);
    expect(result.rows[1]).toMatchObject({
      pathPart: 'berlin-east',
      issues: [{ code: 'path-duplicate', column: 'path', relatedRow: 1, certainty: 'likely' }],
    });
    expect(result.rows[2]).toMatchObject({ issues: [{ code: 'required-empty', column: 'title' }] });
    expect(result.rows[3]).toMatchObject({ issues: [{ code: 'path-in-zesty' }] });
    expect(result.rows[3]?.issues[0]?.message).toContain('7-city-munich');
    expect(result.rows[4]).toMatchObject({
      issues: [{ code: 'relationship-not-zuid', value: 'France' }],
    });
    expect(result.rows[5]).toMatchObject({
      issues: [{ code: 'relationship-unknown', value: '7-country-xx' }],
    });
    expect(result.rows[6]).toMatchObject({
      issues: [{ code: 'number-invalid', value: '4,5', certainty: 'possible' }],
    });
    expect(result.rows[6]?.issues[0]?.message).toContain('use a dot for decimals');
    expect(result.rows[0]?.values.body).toBe('Quiet, green');
    expect(result.unreadableTextRows.map((row) => row.row)).toEqual([7]);
    expect(result.multilineRows.map((row) => row.row)).toEqual([8, 9]);
  });

  it('maps columns by name and drops unknown and shadowed ones', () => {
    const { columns } = check();

    expect(columns.map((column) => [column.header, column.status])).toEqual([
      ['title', 'mapped'],
      ['path', 'path-part'],
      ['rating', 'mapped'],
      ['country', 'mapped'],
      ['body', 'shadowed'],
      ['internal_id', 'unmapped'],
      ['body', 'mapped'],
    ]);
    expect(columns[4]?.filled).toBe(1);
    expect(columns[5]?.filled).toBe(9);
  });

  it('reconciles the line count with the items expected', () => {
    const { funnel } = check();

    expect(funnel).toEqual({
      dataLines: 12,
      continuationLines: 2,
      skippedBlankLines: 1,
      rejected: 6,
      atRisk: 1,
      created: 3,
    });
    expect(
      funnel.dataLines - funnel.rejected - funnel.skippedBlankLines - funnel.continuationLines,
    ).toBe(funnel.created);
  });

  it('reconciles when a skipped blank record spans several lines', () => {
    const result = check('title,path\nBerlin,berlin\n"\n",\nParis,paris\n');
    const { funnel } = result;

    expect(result.rows.map((row) => row.record.line)).toEqual([2, 5]);
    expect(
      funnel.dataLines - funnel.rejected - funnel.skippedBlankLines - funnel.continuationLines,
    ).toBe(funnel.created);
    expect(fileLines(result).filter((entry) => entry.kind === 'unread')).toEqual([]);
  });

  it('counts each row once, under its most certain reason', () => {
    const { reasons, funnel } = check();

    expect(reasons.map((reason) => [reason.code, reason.rows.map((row) => row.row)])).toEqual([
      ['relationship-not-zuid', [5, 9]],
      ['path-duplicate', [2]],
      ['required-empty', [3]],
      ['path-in-zesty', [4]],
      ['relationship-unknown', [6]],
      ['number-invalid', [7]],
    ]);
    expect(check().rows[8]?.issues.map((issue) => issue.code)).toEqual([
      'number-invalid',
      'relationship-not-zuid',
    ]);
    expect(reasons.reduce((sum, reason) => sum + reason.rows.length, 0)).toBe(
      funnel.rejected + funnel.atRisk,
    );
  });

  it('rejects every row when a required field has no column', () => {
    const result = check(cities, {
      ...schema,
      fields: [
        ...schema.fields,
        { id: '12-teaser', name: 'teaser', label: 'Teaser', kind: 'text', required: true },
      ],
    });

    expect(result.rows.every((row) => row.issues[0]?.code === 'required-missing')).toBe(true);
    expect(result.reasons.map((reason) => [reason.code, reason.rows.length])).toEqual([
      ['required-missing', 9],
    ]);
    expect(result.funnel).toMatchObject({ rejected: 9, atRisk: 0, created: 0 });
  });

  it('leaves a URL free when the row that uses it first won’t import', () => {
    const result = check('title,path\n,hamburg\nHamburg,Hamburg\nHamburg again,hamburg\n');

    expect(result.rows.map((row) => row.outcome)).toEqual(['rejected', 'created', 'rejected']);
    expect(result.rows[2]?.primary).toMatchObject({ code: 'path-duplicate', relatedRow: 2 });
  });

  it('marks every row as rejected when Zesty rejects the whole file', () => {
    const result = check('title,path\nBerlin,berlin\nParis,paris,extra\n');

    expect(result.rows.map((row) => row.outcome)).toEqual(['rejected']);
  });

  it('accepts a valid yes/no value even when the field lists options', () => {
    const result = check('title,path,open\nBerlin,berlin,true\nParis,paris,maybe\n', {
      ...schema,
      fields: [
        ...schema.fields,
        { id: '12-open', name: 'open', label: 'Open', kind: 'boolean', options: ['0', '1'] },
      ],
    });

    expect(result.rows.map((row) => row.issues.map((issue) => issue.code))).toEqual([
      [],
      ['boolean-invalid'],
    ]);
  });

  it('accepts dates written as YYYY-MM-DD, with an optional time', () => {
    const result = check(
      [
        'title,path,opened',
        'A,a,2024-03-01',
        'B,b,2024-03-01 09:30',
        'C,c,42',
        'D,d,TBD 5',
        'E,e,01/03/2024',
      ].join('\n'),
      {
        ...schema,
        fields: [
          ...schema.fields,
          { id: '12-opened', name: 'opened', label: 'Opened', kind: 'date' },
        ],
      },
    );

    expect(result.rows.map((row) => row.issues.map((issue) => issue.code))).toEqual([
      [],
      [],
      ['date-invalid'],
      ['date-invalid'],
      ['date-invalid'],
    ]);
  });

  it('applies Zesty’s path-part transform without collapsing dashes', () => {
    expect(zestyPathPart('  Fish & Chips! ')).toBe('fish-and-chips-');
    expect(zestyPathPart('Berlin  East')).toBe('berlin--east');
  });
});

describe('summarize', () => {
  it('groups findings so the deductions add up to the funnel', () => {
    const groups = summarize(check());

    expect(groups.map((group) => [group.id, group.deducted])).toEqual([
      ['file', undefined],
      ['rejected', 6],
      ['not-entries', 3],
      ['possible', undefined],
      ['ignored', undefined],
    ]);
    const [file, rejected, notEntries, possible, ignored] = groups;
    expect(file?.findings.map((finding) => finding.id)).toEqual(['encoding']);
    expect(file?.findings[0]?.lines).toEqual(new Set([8]));
    expect(rejected?.findings.map((finding) => finding.count)).toEqual([2, 1, 1, 1, 1]);
    expect(notEntries?.findings).toMatchObject([
      { id: 'blank', count: 1, lines: new Set([9]) },
      { id: 'multiline', count: 2, lines: new Set([10, 12]) },
    ]);
    expect(possible?.findings).toMatchObject([{ id: 'number-invalid', tone: 'at-risk' }]);
    expect(ignored?.findings.map((finding) => finding.column)).toEqual([4, 5]);
  });

  it('shows only the file problems when Zesty would reject the whole file', () => {
    const result = check('title,path\nBerlin,berlin\nParis,paris,extra\n');

    expect(result.fileRejected).toBe(true);
    expect(result.funnel).toMatchObject({ rejected: 0, created: 0 });
    expect(summarize(result)).toMatchObject([
      {
        id: 'file-rejected',
        findings: [{ label: 'Line 3 has 3 columns; the header has 2.', lines: new Set([3]) }],
      },
    ]);
    expect(summarize(result)).toHaveLength(1);
  });

  it('names a semicolon delimiter as the cause when it breaks the line structure', () => {
    const result = check(['title;path', 'Berlin;berlin', 'Café;4,5'].join('\n'));

    expect(summarize(result)).toMatchObject([
      {
        id: 'file-rejected',
        findings: [
          { id: 'delimiter', label: 'Columns are separated by semicolons' },
          { label: 'Line 3 has 2 columns; the header has 1.' },
        ],
      },
    ]);
  });

  it('says so when not every Zesty item could be compared', () => {
    const [file] = summarize(check(['title,path', 'Berlin,berlin'].join('\n'), schema, false));

    expect(file).toMatchObject({ id: 'file', findings: [{ id: 'incomplete', tone: 'at-risk' }] });
  });
});

describe('file lines', () => {
  it('finds lines by position inside multi-line records, by row, and by text', () => {
    const result = check();
    const lines = fileLines(result);
    const find = (query: string) =>
      lines
        .filter((entry) => matchesLineQuery(entry, parseLineQuery(query)))
        .map((entry) => entry.line);

    expect(lines.map((entry) => [entry.line, entry.kind])).toContainEqual([9, 'blank']);
    expect(lines.filter((entry) => !needsAttention(entry)).map((entry) => entry.line)).toEqual([2]);
    expect(parseLineQuery(' Line 11 ')).toEqual({ kind: 'line', line: 11 });
    expect(find('line 11')).toEqual([10]);
    expect(find('line 9')).toEqual([9]);
    expect(find('row 7')).toEqual([8]);
    expect(find('#9')).toEqual([12]);
    expect(find('BERLIN')).toEqual([2, 3]);
    expect(find('')).toHaveLength(lines.length);
  });

  it('matches a finding on any line of a multi-line record', () => {
    const lines = fileLines(check());

    expect(
      lines.filter((entry) => takesAnyLine(entry, new Set([11]))).map((entry) => entry.line),
    ).toEqual([10]);
  });
});

describe('exports', () => {
  it('writes problem rows as valid CSV with a problem column', () => {
    const result = check();
    const problems = problemRowsCsv(result);
    const reparsed = parseCsv(problems.text);

    expect(problems).toMatchObject({ fileName: 'cities.problems.csv', rows: 7 });
    expect(problems.text).toContain('"4,5"');
    expect(problems.text).toContain('"She said ""oui"", twice"');
    expect(problems.text).toContain('"Line one\nline two"');
    expect(reparsed.fileProblems).toEqual([]);
    expect(reparsed.header).toEqual([...result.parsed.header, 'problem']);
    expect(reparsed.records.map((record) => record.cells.slice(0, -1))).toEqual(
      result.rows.filter((row) => row.outcome !== 'created').map((row) => row.record.cells),
    );
    expect(reparsed.records[0]?.cells.at(-1)).toMatch(/^Won.t import: .*like row 1\.$/);
    expect(reparsed.records[5]?.cells.at(-1)).toMatch(/^May fail: /);
    expect(importableRowsCsv(result).rows).toBe(3);
  });

  it('states the reconciliation in the Markdown report', () => {
    const result = check();
    const report = markdownReport(result, summarize(result), 'Cities');

    expect(report).toContain('# Import check: cities.csv → Cities');
    expect(report).toContain('**3 items expected** from 12 lines.');
    expect(report).toContain('12 lines − 6 won’t import − 3 lines that aren’t entries = 3 items');
    expect(report).toContain('## Won’t import (−6)');
  });
});
