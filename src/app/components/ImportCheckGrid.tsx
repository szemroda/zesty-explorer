import { CornerDownLeft, FileWarning } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  describeFileProblem,
  lineRange,
  type ColumnCheck,
  type FileLine,
  type ImportCheck,
  type RowIssue,
  type RowOutcome,
} from '../../import-check';
import { cn } from '../lib/utils';
import { TooltipTrigger } from './ui/tooltip';

const outcomeStripe: Readonly<Record<RowOutcome, string>> = {
  created: 'bg-emerald-500/70',
  'at-risk': 'bg-amber-400',
  rejected: 'bg-destructive',
};

const outcomeWord: Readonly<Record<RowOutcome, string>> = {
  created: 'will be created',
  'at-risk': 'may fail',
  rejected: 'won’t import',
};

const isDropped = (column: ColumnCheck) =>
  column.status === 'unmapped' || column.status === 'shadowed';

/** The file as a table: one row per record, blank line or unreadable line, marked by outcome. */
export function ImportCheckGrid({
  check,
  lines,
  selectedLine,
  onSelect,
  highlight,
  focusColumn,
}: {
  readonly check: ImportCheck;
  readonly lines: readonly FileLine[];
  readonly selectedLine: number | undefined;
  readonly onSelect: (line: number) => void;
  /** Text to mark in cells. */
  readonly highlight?: string;
  /** A header index to emphasise and scroll to. */
  readonly focusColumn?: number;
}) {
  return (
    <div
      className="min-h-0 flex-1 overflow-auto"
      role="region"
      aria-label={`Lines of ${check.fileName}`}
      tabIndex={0}
    >
      <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th
              scope="col"
              className="border-border bg-surface-header text-muted-foreground sticky top-0 left-0 z-30 w-16 border-r border-b px-3 py-2 text-right font-mono font-normal"
            >
              1
            </th>
            {check.columns.map((column) => (
              <ColumnHeader
                key={column.index}
                column={column}
                check={check}
                focused={column.index === focusColumn}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((entry) => (
            <GridRow
              key={entry.line}
              entry={entry}
              check={check}
              selected={entry.line === selectedLine}
              onSelect={onSelect}
              highlight={highlight}
              focusColumn={focusColumn}
            />
          ))}
        </tbody>
      </table>
      {lines.length === 0 ? (
        <p className="text-muted-foreground p-8 text-center text-sm">Nothing matches.</p>
      ) : null}
    </div>
  );
}

function columnTooltip(column: ColumnCheck, check: ImportCheck): string {
  const records = check.rows.length;
  if (column.status === 'unmapped') {
    return `No field is called “${column.header}”, so Zesty drops this column without a warning.`;
  }
  if (column.status === 'shadowed') {
    return 'A later column has the same name. Zesty keys cells by header, so this column is lost.';
  }
  const filled = `${column.filled} of ${records} rows filled`;
  if (column.status === 'path-part') {
    return `Becomes each page’s URL: lowercased, “&” becomes “and”, every other character becomes “-”. ${filled}.`;
  }
  const { field } = column;
  const type = (field.datatype ?? field.kind).replaceAll('_', ' ');
  return `→ ${field.label} (${type}${field.required ? ', required' : ''}). ${filled}.`;
}

function ColumnHeader({
  column,
  check,
  focused,
}: {
  readonly column: ColumnCheck;
  readonly check: ImportCheck;
  readonly focused: boolean;
}) {
  const dropped = isDropped(column);
  return (
    <th
      scope="col"
      data-focused={focused || undefined}
      className={cn(
        'border-border bg-surface-header sticky top-0 z-20 min-w-40 border-r border-b p-0 text-left font-normal',
        focused && 'bg-primary/15 shadow-[inset_0_-2px_0_var(--color-primary)]',
      )}
    >
      <TooltipTrigger
        text={columnTooltip(column, check)}
        render={<div tabIndex={0} className="px-3 py-2 outline-none" />}
      >
        <span
          className={cn(
            'block truncate font-mono text-xs font-semibold',
            dropped ? 'text-muted-foreground line-through' : 'text-foreground',
          )}
        >
          {column.header}
        </span>
      </TooltipTrigger>
    </th>
  );
}

function GridRow({
  entry,
  check,
  selected,
  onSelect,
  highlight,
  focusColumn,
}: {
  readonly entry: FileLine;
  readonly check: ImportCheck;
  readonly selected: boolean;
  readonly onSelect: (line: number) => void;
  readonly highlight: string | undefined;
  readonly focusColumn: number | undefined;
}) {
  const rowClass = cn(
    'group scroll-mt-10 scroll-mb-4 cursor-pointer',
    selected ? 'bg-primary/10' : 'hover:bg-surface-hover',
  );
  if (entry.kind !== 'record') {
    const blank = entry.kind === 'blank';
    const description = blank
      ? 'Blank line · skipped by Zesty without a message'
      : entry.problem
        ? describeFileProblem(entry.problem)
        : 'Not read as a record.';
    return (
      <tr
        data-line={entry.line}
        aria-selected={selected}
        className={rowClass}
        onClick={() => onSelect(entry.line)}
      >
        <Gutter
          lines={[entry.line]}
          stripe={blank ? undefined : outcomeStripe.rejected}
          struck={blank}
          selected={selected}
          label={`Line ${entry.line}: ${description}`}
        />
        <td
          colSpan={check.columns.length}
          className={cn(
            'border-border/60 h-8 border-b p-0',
            blank
              ? 'bg-[repeating-linear-gradient(135deg,transparent_0_7px,color-mix(in_oklab,var(--color-border)_70%,transparent)_7px_8px)]'
              : 'bg-destructive/10',
          )}
        >
          <span
            className={cn(
              'sticky left-16 inline-flex items-center gap-1.5 px-3 text-[11px] italic',
              blank ? 'text-muted-foreground' : 'text-destructive',
            )}
          >
            {blank ? (
              <span className="bg-background/80 rounded px-1.5 py-0.5 not-italic">
                {description}
              </span>
            ) : (
              <>
                <FileWarning size={12} aria-hidden="true" />
                {description}
              </>
            )}
          </span>
        </td>
      </tr>
    );
  }

  const { row, problem } = entry;
  const lineNumbers = Array.from({ length: row.record.lineSpan }, (_, index) => entry.line + index);
  const { primary } = row;
  return (
    <tr
      data-line={entry.line}
      aria-selected={selected}
      className={rowClass}
      onClick={() => onSelect(entry.line)}
    >
      <Gutter
        lines={lineNumbers}
        stripe={problem ? outcomeStripe.rejected : outcomeStripe[row.outcome]}
        selected={selected}
        label={`Row ${row.row}, ${lineRange(row).toLowerCase()}: ${outcomeWord[row.outcome]}${
          primary ? `. ${primary.message}` : ''
        }`}
      />
      {check.columns.map((column) => (
        <Cell
          key={column.index}
          column={column}
          value={row.record.cells[column.index] ?? ''}
          issue={
            column.status === 'shadowed'
              ? undefined
              : row.issues.find((issue) => issue.column === column.header)
          }
          fileProblem={problem !== undefined}
          highlight={highlight}
          focused={column.index === focusColumn}
        />
      ))}
    </tr>
  );
}

function Gutter({
  lines,
  stripe,
  struck = false,
  selected,
  label,
}: {
  readonly lines: readonly number[];
  readonly stripe: string | undefined;
  readonly struck?: boolean;
  readonly selected: boolean;
  readonly label: string;
}) {
  return (
    <th
      scope="row"
      className={cn(
        'border-border bg-card sticky left-0 z-10 border-r border-b p-0 text-right align-top font-mono font-normal',
        selected ? 'bg-linear-to-r from-primary/15 to-primary/15' : 'group-hover:bg-surface-hover',
      )}
    >
      <button
        type="button"
        aria-label={label}
        aria-pressed={selected}
        className="focus-visible:ring-ring/45 relative block w-16 cursor-pointer px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        {stripe ? (
          <span
            className={cn('absolute inset-y-0 left-0', selected ? 'w-1' : 'w-[3px]', stripe)}
            aria-hidden="true"
          />
        ) : null}
        {lines.map((line) => (
          <span
            key={line}
            className={cn(
              'block leading-5 tabular-nums',
              selected ? 'text-foreground' : 'text-muted-foreground',
              struck && 'line-through opacity-70',
            )}
          >
            {line}
          </span>
        ))}
      </button>
    </th>
  );
}

function Cell({
  column,
  value,
  issue,
  fileProblem,
  highlight,
  focused,
}: {
  readonly column: ColumnCheck;
  readonly value: string;
  readonly issue: RowIssue | undefined;
  readonly fileProblem: boolean;
  readonly highlight: string | undefined;
  readonly focused: boolean;
}) {
  const parts = value.split('\n');
  const content =
    value.trim() === '' && issue ? (
      <span className="text-destructive/80 italic">empty</span>
    ) : (
      parts.map((part, index) => (
        <span key={index} className="flex items-center gap-1 leading-5">
          <span className="truncate">
            <Highlighted text={part} query={highlight} />
          </span>
          {index < parts.length - 1 ? (
            <CornerDownLeft size={11} className="text-primary shrink-0" aria-label="line break" />
          ) : null}
        </span>
      ))
    );
  const tone = issue ? (issue.certainty === 'possible' ? 'at-risk' : 'rejected') : undefined;
  return (
    <td
      className={cn(
        'border-border/60 relative max-w-64 border-r border-b p-0 align-top',
        isDropped(column) && 'text-muted-foreground/60',
        tone === 'rejected' && 'bg-destructive/25 text-rose-100',
        tone === 'at-risk' && 'bg-amber-500/20 text-amber-100',
        fileProblem && 'bg-destructive/10',
        focused && !tone && 'bg-primary/5',
      )}
    >
      {issue ? (
        <TooltipTrigger
          text={issue.message}
          render={<span className="block px-3 py-1.5 outline-none" tabIndex={-1} />}
        >
          <span
            className={cn(
              'absolute top-0 right-0 size-0 border-4 border-b-transparent border-l-transparent',
              tone === 'rejected'
                ? 'border-t-destructive border-r-destructive'
                : 'border-t-amber-400 border-r-amber-400',
            )}
            aria-hidden="true"
          />
          {content}
        </TooltipTrigger>
      ) : (
        <span className="block px-3 py-1.5">{content}</span>
      )}
    </td>
  );
}

/** Marks every case-insensitive occurrence of `query` in `text`. */
function Highlighted({
  text,
  query,
}: {
  readonly text: string;
  readonly query: string | undefined;
}) {
  const needle = query?.trim().toLowerCase();
  if (!needle) return text;
  const parts: ReactNode[] = [];
  const haystack = text.toLowerCase();
  let from = 0;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, from)) {
    parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="bg-primary/35 text-foreground rounded-sm">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return parts;
}
