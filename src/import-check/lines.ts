// The file as the checker shows it: one entry per record, blank line or unreadable line, and the
// searches that narrow it.
import type { ImportCheck, RowCheck } from './analysis';
import type { FileProblem } from './csv';

/** One entry per physical line a record starts on, blank line, or line Zesty could not read. */
export type FileLine =
  | {
      readonly kind: 'record';
      readonly line: number;
      readonly row: RowCheck;
      readonly problem: FileProblem | undefined;
    }
  | { readonly kind: 'blank'; readonly line: number }
  | { readonly kind: 'unread'; readonly line: number; readonly problem: FileProblem | undefined };

/** Lays out every physical line after the header. */
export function fileLines(check: ImportCheck): FileLine[] {
  const covered = new Set<number>([1]);
  const problemOn = new Map(check.fileProblems.map((problem) => [problem.line, problem]));
  const lines: FileLine[] = check.rows.map((row) => {
    const { line, lineSpan } = row.record;
    let problem: FileProblem | undefined;
    for (let offset = 0; offset < lineSpan; offset += 1) {
      covered.add(line + offset);
      problem ??= problemOn.get(line + offset);
    }
    return { kind: 'record', line, row, problem };
  });
  for (const line of check.parsed.skippedBlankLines) {
    covered.add(line);
    lines.push({ kind: 'blank', line });
  }
  for (let line = 2; line <= check.parsed.physicalLines; line += 1) {
    if (!covered.has(line)) lines.push({ kind: 'unread', line, problem: problemOn.get(line) });
  }
  return lines.toSorted((a, b) => a.line - b.line);
}

const spanOf = (entry: FileLine) => (entry.kind === 'record' ? entry.row.record.lineSpan : 1);

/** Whether any physical line the entry takes, e.g. both lines of a two-line record, is in `lines`. */
export function takesAnyLine(entry: FileLine, lines: ReadonlySet<number>): boolean {
  for (let offset = 0; offset < spanOf(entry); offset += 1) {
    if (lines.has(entry.line + offset)) return true;
  }
  return false;
}

/** Whether the line explains a difference between the line count and the items created. */
export function needsAttention(entry: FileLine): boolean {
  if (entry.kind !== 'record') return true;
  return entry.row.outcome !== 'created' || entry.row.record.lineSpan > 1 || Boolean(entry.problem);
}

export function lineRange(row: RowCheck): string {
  const { line, lineSpan } = row.record;
  return lineSpan > 1 ? `Lines ${line}–${line + lineSpan - 1}` : `Line ${line}`;
}

export type LineQuery =
  | { readonly kind: 'none' }
  | { readonly kind: 'line'; readonly line: number }
  | { readonly kind: 'row'; readonly row: number }
  | { readonly kind: 'text'; readonly text: string };

/** Reads `line 12` and `row 12` as positions; anything else searches cell text. */
export function parseLineQuery(input: string): LineQuery {
  const trimmed = input.trim();
  if (!trimmed) return { kind: 'none' };
  const line = /^line\s*(\d+)$/i.exec(trimmed)?.[1];
  if (line) return { kind: 'line', line: Number(line) };
  const row = /^(?:row|#)\s*(\d+)$/i.exec(trimmed)?.[1];
  if (row) return { kind: 'row', row: Number(row) };
  return { kind: 'text', text: trimmed.toLowerCase() };
}

export function matchesLineQuery(entry: FileLine, query: LineQuery): boolean {
  if (query.kind === 'none') return true;
  if (query.kind === 'line') {
    return query.line >= entry.line && query.line < entry.line + spanOf(entry);
  }
  if (entry.kind !== 'record') return false;
  if (query.kind === 'row') return entry.row.row === query.row;
  return entry.row.record.cells.some((cell) => cell.toLowerCase().includes(query.text));
}
