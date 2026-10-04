// The checker's summary: groups of findings that reconcile the file's line count with the items
// expected (lines − won't import − lines that aren't entries = items).
import { describeFileProblem, type ImportCheck, type ReasonGroup } from './analysis';

export type FindingTone = 'rejected' | 'at-risk' | 'quiet';

/** One finding; its `lines` are the physical lines it concerns, or every line when absent. */
export interface Finding {
  readonly id: string;
  readonly label: string;
  readonly count?: number;
  readonly fix: string;
  readonly tone: FindingTone;
  readonly lines?: ReadonlySet<number>;
  /** The column a finding is about, as a header index. */
  readonly column?: number;
}

export interface FindingGroup {
  readonly id: string;
  readonly title: string;
  /** What the group takes off the line count, e.g. 28 for "−28". */
  readonly deducted?: number;
  readonly findings: readonly Finding[];
}

const delimiterName = { ';': 'semicolons', '\t': 'tabs', '|': 'pipes' } as const;

function reasonFinding(reason: ReasonGroup, tone: FindingTone): Finding {
  return {
    id: reason.code,
    label: reason.title,
    count: reason.rows.length,
    fix: reason.fix,
    tone,
    lines: new Set(reason.rows.map((row) => row.record.line)),
  };
}

function delimiterFindings(check: ImportCheck): Finding[] {
  const delimiter = check.parsed.suspectedDelimiter;
  if (!delimiter) return [];
  return [
    {
      id: 'delimiter',
      label: `Columns are separated by ${delimiterName[delimiter]}`,
      fix: 'Zesty only splits on commas, so each line arrives as one column. Export the file again as “CSV (comma delimited)”.',
      tone: 'rejected',
    },
  ];
}

function fileFindings(check: ImportCheck): Finding[] {
  const findings = delimiterFindings(check);
  if (!check.zestyDataComplete) {
    findings.push({
      id: 'incomplete',
      label: 'Not every Zesty item was compared',
      fix: 'Some items couldn’t be read, or a collection has more than 10,000 items, so some URLs and related items went unchecked.',
      tone: 'at-risk',
    });
  }
  if (check.unreadableTextRows.length > 0) {
    findings.push({
      id: 'encoding',
      label: 'Text that isn’t UTF-8',
      count: check.unreadableTextRows.length,
      fix: 'Zesty reads the file as UTF-8, so characters such as umlauts arrive as “�”. Save the file as “CSV UTF-8” and check it again.',
      tone: 'at-risk',
      lines: new Set(check.unreadableTextRows.map((row) => row.record.line)),
    });
  }
  return findings;
}

export function summarize(check: ImportCheck): FindingGroup[] {
  if (check.fileRejected) {
    return [
      {
        id: 'file-rejected',
        title: 'Zesty will reject the whole file',
        // A wrong delimiter is usually why the lines don't line up, so it comes first.
        findings: [
          ...delimiterFindings(check),
          ...check.fileProblems.map((problem, index) => ({
            id: `file-problem-${index}`,
            label: describeFileProblem(problem),
            fix: 'Fix this line; Zesty imports nothing until every line can be read.',
            tone: 'rejected' as const,
            lines: new Set([problem.line]),
          })),
        ],
      },
    ];
  }
  const { funnel } = check;
  const notEntries: Finding[] = [];
  if (funnel.skippedBlankLines > 0) {
    notEntries.push({
      id: 'blank',
      label: 'Blank lines',
      count: funnel.skippedBlankLines,
      fix: 'Zesty skips them without a message. Nothing to do.',
      tone: 'quiet',
      lines: new Set(check.parsed.skippedBlankLines),
    });
  }
  if (funnel.continuationLines > 0) {
    notEntries.push({
      id: 'multiline',
      label: 'Line breaks inside cells',
      count: funnel.continuationLines,
      fix: 'Each of these entries spans several lines but is still one item. Nothing to do.',
      tone: 'quiet',
      lines: new Set(check.multilineRows.map((row) => row.record.line)),
    });
  }
  const groups: FindingGroup[] = [
    { id: 'file', title: 'About the file', findings: fileFindings(check) },
    {
      id: 'rejected',
      title: 'Won’t import',
      deducted: funnel.rejected,
      findings: check.reasons
        .filter((reason) => reason.certainty === 'likely')
        .map((reason) => reasonFinding(reason, 'rejected')),
    },
    {
      id: 'not-entries',
      title: 'Lines that aren’t entries',
      deducted: funnel.skippedBlankLines + funnel.continuationLines,
      findings: notEntries,
    },
    {
      id: 'possible',
      title: 'May fail (counted as imported)',
      findings: check.reasons
        .filter((reason) => reason.certainty === 'possible')
        .map((reason) => reasonFinding(reason, 'at-risk')),
    },
    {
      id: 'ignored',
      title: 'Columns that aren’t imported',
      findings: check.columns
        .filter((column) => column.status === 'unmapped' || column.status === 'shadowed')
        .map((column) => ({
          id: `column-${column.index}`,
          label: column.header,
          fix:
            column.status === 'shadowed'
              ? `A later column is also called “${column.header}”, so Zesty drops this one.`
              : `No field is called “${column.header}”, so Zesty drops its ${column.filled} values without a warning.`,
          tone: 'quiet',
          column: column.index,
        })),
    },
  ];
  return groups.filter((group) => group.findings.length > 0);
}
