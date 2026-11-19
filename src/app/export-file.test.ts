// @vitest-environment node
// fflate tells file bytes from folders with `instanceof Uint8Array`, which fails across jsdom realms.
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { csvText, exportBaseName, jsonText, xlsxBytes } from './export-file';
import type { ExportTable } from './table-export';

const table: ExportTable = {
  headers: ['Title', 'Words', 'Note'],
  rows: [
    ['Fish, chips & "peas"', 120, null],
    ['=SUM(A1)', 0, 'Line one\nline two'],
  ],
};

describe('export files', () => {
  it('writes CSV that Excel reads as UTF-8 and never runs as a formula', () => {
    expect(csvText(table)).toBe(
      '﻿Title,Words,Note\r\n"Fish, chips & ""peas""",120,\r\n\'=SUM(A1),0,"Line one\nline two"\r\n',
    );
  });

  it('writes JSON as one object per row', () => {
    expect(JSON.parse(jsonText(table))).toEqual([
      { Title: 'Fish, chips & "peas"', Words: 120, Note: null },
      { Title: '=SUM(A1)', Words: 0, Note: 'Line one\nline two' },
    ]);
  });

  it('writes a workbook whose sheet holds numbers as numbers and text as escaped text', () => {
    const files = unzipSync(xlsxBytes(table, 'Blog: "Posts"'));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);

    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(strFromU8(files['xl/workbook.xml']!)).toContain('<sheet name="Blog  &quot;Posts&quot;"');
    expect(sheet).toContain(
      '<row r="1"><c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Title</t></is></c>',
    );
    expect(sheet).toContain(
      '<row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve">Fish, chips &amp; "peas"</t></is></c><c r="B2"><v>120</v></c></row>',
    );
  });

  it('cuts text to the longest cell Excel opens without repairing the workbook', () => {
    const long: ExportTable = { headers: ['Body'], rows: [['x'.repeat(40_000)]] };
    const sheet = strFromU8(unzipSync(xlsxBytes(long, 'Posts'))['xl/worksheets/sheet1.xml']!);

    expect(sheet).toContain(`<t xml:space="preserve">${'x'.repeat(32_766)}…</t>`);
  });

  it('names a file after its subject, content state, language and day', () => {
    expect(
      exportBaseName(
        'Blog Articles',
        { state: 'published', language: 'en-US' },
        new Date(2026, 10, 19, 23, 30),
      ),
    ).toBe('blog-articles_published_en-us_2026-11-19');
  });
});
