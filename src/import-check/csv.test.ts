import { describe, expect, it } from 'vitest';
import { parseCsv } from './index';

const bom = String.fromCodePoint(0xfeff);

describe('parseCsv', () => {
  it('strips a UTF-8 BOM and reads CRLF line endings', () => {
    const parsed = parseCsv(`${bom}title,path\r\nBerlin,berlin\r\nParis,paris\r\n`);

    expect(parsed.header).toEqual(['title', 'path']);
    expect(parsed.physicalLines).toBe(3);
    expect(parsed.records).toEqual([
      { line: 2, lineSpan: 1, cells: ['Berlin', 'berlin'] },
      { line: 3, lineSpan: 1, cells: ['Paris', 'paris'] },
    ]);
    expect(parsed.fileProblems).toEqual([]);
  });

  it('keeps quoted commas, escaped quotes and line breaks inside one record', () => {
    const parsed = parseCsv(
      [
        'title,body',
        '"Fish, chips","He said ""hi"""',
        'Multi,"one',
        'two',
        'three"',
        'Last,x',
      ].join('\n'),
    );

    expect(parsed.physicalLines).toBe(6);
    expect(parsed.records).toEqual([
      { line: 2, lineSpan: 1, cells: ['Fish, chips', 'He said "hi"'] },
      { line: 3, lineSpan: 3, cells: ['Multi', 'one\ntwo\nthree'] },
      { line: 6, lineSpan: 1, cells: ['Last', 'x'] },
    ]);
    expect(parsed.fileProblems).toEqual([]);
  });

  it('skips empty and all-blank lines instead of making records of them', () => {
    const parsed = parseCsv(
      ['title,path,rating', '', 'Berlin,berlin,4', ',,', ' , , ', 'Paris,paris,5', '', ''].join(
        '\n',
      ),
    );

    expect(parsed.physicalLines).toBe(7);
    expect(parsed.records.map((record) => record.line)).toEqual([3, 6]);
    expect(parsed.skippedBlankLines).toEqual([2, 4, 5, 7]);
    expect(parsed.fileProblems).toEqual([]);
  });

  it('reports malformed lines as file problems on the line they occur', () => {
    const columnCount = parseCsv('title,path\nBerlin,berlin\nParis,paris,extra\n');
    expect(columnCount.fileProblems).toEqual([
      { kind: 'column-count', line: 3, expected: 2, found: 3 },
    ]);
    expect(columnCount.records.map((record) => record.line)).toEqual([2]);

    expect(parseCsv('title,path\nBer"lin,berlin\n').fileProblems).toEqual([
      { kind: 'stray-quote', line: 2 },
    ]);
    expect(parseCsv('title,body\nA,b\nC,"one\ntwo"x\n').fileProblems).toEqual([
      { kind: 'stray-quote', line: 4 },
    ]);
    expect(parseCsv('title,body\nA,b\nC,"never closed\nD,d\n').fileProblems).toEqual([
      { kind: 'unclosed-quote', line: 3 },
    ]);
  });

  it('suspects another delimiter only when the header has no comma', () => {
    const parsed = parseCsv('title;path\nBerlin;berlin\n');

    expect(parsed.suspectedDelimiter).toBe(';');
    expect(parsed.header).toEqual(['title;path']);
    expect(parsed.fileProblems).toEqual([]);
    expect(parseCsv('title,path;slug\nBerlin,berlin;b\n').suspectedDelimiter).toBeUndefined();
  });
});
