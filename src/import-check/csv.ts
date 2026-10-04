// Reads a CSV the way Zesty's Import CSV does (csv-parse 4 with `skip_empty_lines` and
// `skip_lines_with_empty_values`), but keeps line provenance and collects every problem instead of
// stopping at the first, so the checker can explain the record count.

export interface CsvRecord {
  /** 1-based physical line where the record starts. */
  readonly line: number;
  /** Physical lines the record spans; above 1 when a quoted cell contains line breaks. */
  readonly lineSpan: number;
  readonly cells: readonly string[];
}

/** A problem that makes Zesty reject the whole file before any item is created. */
export type FileProblem =
  | {
      readonly kind: 'column-count';
      readonly line: number;
      readonly expected: number;
      readonly found: number;
    }
  | { readonly kind: 'stray-quote'; readonly line: number }
  | { readonly kind: 'unclosed-quote'; readonly line: number };

export interface ParsedCsv {
  /** Lines a text editor shows, including the header. */
  readonly physicalLines: number;
  readonly header: readonly string[];
  /** Records Zesty would try to import, in file order. */
  readonly records: readonly CsvRecord[];
  /** Lines that are empty, or whose cells are all blank: Zesty drops them without a message. */
  readonly skippedBlankLines: readonly number[];
  readonly fileProblems: readonly FileProblem[];
  /** Set when the header looks separated by another character than a comma. */
  readonly suspectedDelimiter?: ';' | '\t' | '|';
}

function suspectDelimiter(headerLine: string): ParsedCsv['suspectedDelimiter'] {
  if (headerLine.includes(',')) return undefined;
  for (const candidate of [';', '\t', '|'] as const) {
    if (headerLine.includes(candidate)) return candidate;
  }
  return undefined;
}

export function parseCsv(input: string): ParsedCsv {
  const hasBom = input.startsWith('\uFEFF');
  const text = (hasBom ? input.slice(1) : input).replace(/\r\n?/g, '\n');
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  const physicalLines = body === '' ? 0 : body.split('\n').length;

  const rows: CsvRecord[] = [];
  const skippedBlankLines: number[] = [];
  const fileProblems: FileProblem[] = [];
  let cells: string[] = [];
  let cell = '';
  let cellWasQuoted = false;
  let quoted = false;
  let line = 1;
  let recordStart = 1;
  let quoteOpenedAt = 0;

  const endRecord = () => {
    cells.push(cell);
    const rawEmpty = cells.length === 1 && cell === '' && !cellWasQuoted;
    const expected = rows[0]?.cells.length;
    const allBlank = cells.every((value) => value.trim() === '');
    if (rawEmpty) {
      skippedBlankLines.push(recordStart);
    } else if (expected !== undefined && cells.length !== expected) {
      fileProblems.push({ kind: 'column-count', line: recordStart, expected, found: cells.length });
    } else if (allBlank && rows.length > 0) {
      for (let skipped = recordStart; skipped <= line; skipped += 1)
        skippedBlankLines.push(skipped);
    } else {
      rows.push({ line: recordStart, lineSpan: line - recordStart + 1, cells });
    }
    cells = [];
    cell = '';
    cellWasQuoted = false;
  };

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (quoted) {
      if (char === '"' && body[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        const next = body[index + 1];
        if (next !== undefined && next !== ',' && next !== '\n') {
          fileProblems.push({ kind: 'stray-quote', line });
        }
      } else {
        if (char === '\n') line += 1;
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      if (cell === '' && !cellWasQuoted) {
        quoted = true;
        cellWasQuoted = true;
        quoteOpenedAt = line;
      } else {
        fileProblems.push({ kind: 'stray-quote', line });
        cell += char;
      }
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
      cellWasQuoted = false;
    } else if (char === '\n') {
      endRecord();
      line += 1;
      recordStart = line;
    } else {
      cell += char;
    }
  }
  if (body !== '') endRecord();
  if (quoted) fileProblems.push({ kind: 'unclosed-quote', line: quoteOpenedAt });

  const [header, ...records] = rows;
  const headerEnd = body.indexOf('\n');
  const headerLine = headerEnd < 0 ? body : body.slice(0, headerEnd);
  const suspectedDelimiter = suspectDelimiter(headerLine);
  return {
    physicalLines,
    header: header?.cells ?? [],
    records,
    skippedBlankLines,
    fileProblems,
    ...(suspectedDelimiter ? { suspectedDelimiter } : {}),
  };
}
