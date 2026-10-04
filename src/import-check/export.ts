// What a user can take away from a check: CSV files split by outcome and a Markdown report.
import type { ImportCheck, RowCheck } from './analysis';
import type { FindingGroup } from './summary';

const csvCell = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

const csvText = (lines: readonly (readonly string[])[]) =>
  `${lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`;

const baseName = (fileName: string) => fileName.replace(/\.csv$/i, '');

export interface CsvExport {
  readonly fileName: string;
  readonly text: string;
  readonly rows: number;
}

/** Rows that won't import or may fail, with a `problem` column that says why. */
export function problemRowsCsv(check: ImportCheck): CsvExport {
  const rows = check.rows.filter((row) => row.outcome !== 'created');
  return {
    fileName: `${baseName(check.fileName)}.problems.csv`,
    rows: rows.length,
    text: csvText([
      [...check.parsed.header, 'problem'],
      ...rows.map((row) => [...row.record.cells, problemText(row)]),
    ]),
  };
}

function problemText(row: RowCheck): string {
  const prefix = row.outcome === 'rejected' ? 'Won’t import' : 'May fail';
  return `${prefix}: ${row.issues.map((issue) => issue.message).join(' ')}`;
}

/** Rows expected to import, including those that may fail, ready for Zesty's Import CSV. */
export function importableRowsCsv(check: ImportCheck): CsvExport {
  const rows = check.rows.filter((row) => row.outcome !== 'rejected');
  return {
    fileName: `${baseName(check.fileName)}.importable.csv`,
    rows: rows.length,
    text: csvText([check.parsed.header, ...rows.map((row) => row.record.cells)]),
  };
}

const listedLines = 20;

export function markdownReport(
  check: ImportCheck,
  groups: readonly FindingGroup[],
  collectionLabel: string,
): string {
  const { funnel } = check;
  const lines = [`# Import check: ${check.fileName} → ${collectionLabel}`, ''];
  if (check.fileRejected) {
    lines.push('**Zesty will reject the whole file: no items will be created.**');
  } else {
    const notEntries = funnel.skippedBlankLines + funnel.continuationLines;
    lines.push(
      `**${funnel.created} items expected** from ${funnel.dataLines} lines.`,
      '',
      `${funnel.dataLines} lines − ${funnel.rejected} won’t import − ${notEntries} lines that aren’t entries = ${funnel.created} items`,
    );
  }
  for (const group of groups) {
    const deducted = group.deducted === undefined ? '' : ` (−${group.deducted})`;
    lines.push('', `## ${group.title}${deducted}`);
    for (const finding of group.findings) {
      const count = finding.count === undefined ? '' : `: ${finding.count}`;
      const numbers = [...(finding.lines ?? [])];
      const where =
        numbers.length === 0
          ? ''
          : ` — ${numbers.length === 1 ? 'line' : 'lines'} ${numbers.slice(0, listedLines).join(', ')}${numbers.length > listedLines ? ', …' : ''}`;
      lines.push(`- ${finding.label}${count}${where}. ${finding.fix}`);
    }
  }
  lines.push('', '_Predicted by Zesty Explorer. Nothing was written to Zesty._');
  return lines.join('\n');
}
