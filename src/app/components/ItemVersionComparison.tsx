import { useState, type ReactNode } from 'react';
import {
  collapseUnchanged,
  diffRawJson,
  diffText,
  type ChangedValue,
  type ContentItemComparison,
  type DiffSection,
  type NumberedLine,
  type RawJsonRow,
  type TextFragment,
  type TextLine,
  type ValueChange,
  type ValuePath,
  type VersionPair,
} from '../item-version-comparison';

type Side = 'before' | 'after';

// Unchanged rows kept around each change before the rest collapse.
const FIELD_TEXT_CONTEXT = 2;
const RAW_JSON_CONTEXT = 3;

const SIDE_STYLE: Readonly<
  Record<
    Side,
    {
      readonly mark: string;
      readonly border: string;
      readonly line: string;
      readonly text: string;
      readonly marker: string;
    }
  >
> = {
  before: {
    mark: 'bg-destructive/35',
    border: 'border-destructive/60',
    line: 'bg-destructive/10',
    text: 'text-destructive',
    marker: '−',
  },
  after: {
    mark: 'bg-primary/30',
    border: 'border-primary/70',
    line: 'bg-primary/10',
    text: 'text-primary',
    marker: '+',
  },
};

function unchangedLinesLabel(count: number): string {
  return `⋯ Show ${count} unchanged ${count === 1 ? 'line' : 'lines'}`;
}

function Fragments({
  fragments,
  side,
}: {
  readonly fragments: readonly TextFragment[];
  readonly side: Side;
}) {
  return fragments.map((fragment, index) =>
    fragment.highlighted ? (
      <mark key={index} className={`rounded-sm text-inherit ${SIDE_STYLE[side].mark}`}>
        {fragment.text}
      </mark>
    ) : (
      fragment.text
    ),
  );
}

/** Renders visible sections and a button for each hidden run of unchanged rows. */
function CollapsibleRows<Row>({
  sections,
  renderRow,
  renderExpander,
}: {
  readonly sections: readonly DiffSection<Row>[];
  readonly renderRow: (row: Row, key: string) => ReactNode;
  readonly renderExpander: (count: number, expand: () => void, key: string) => ReactNode;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  return sections.flatMap((section, sectionIndex) =>
    section.hidden && !expanded.has(sectionIndex)
      ? renderExpander(
          section.rows.length,
          () => setExpanded(new Set([...expanded, sectionIndex])),
          `gap-${sectionIndex}`,
        )
      : section.rows.map((row, rowIndex) => renderRow(row, `${sectionIndex}-${rowIndex}`)),
  );
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'string') return 'text';
  return typeof value;
}

function Literal({ children }: { readonly children: ReactNode }) {
  return (
    <span className="align-top font-mono text-[11px] text-muted-foreground italic">{children}</span>
  );
}

function ValueContent({ value }: { readonly value: unknown }) {
  if (value === null) return <Literal>null</Literal>;
  if (value === '') return <Literal>empty text</Literal>;
  if (typeof value === 'string') return <span className="whitespace-pre-wrap">{value}</span>;
  if (typeof value === 'object') {
    return (
      <pre className="m-0 font-mono text-[11px] leading-5 whitespace-pre-wrap text-code-content">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span className="align-top font-mono text-[11px]">{JSON.stringify(value)}</span>;
}

function ValueText({
  value,
  typeChanged,
}: {
  readonly value: unknown;
  readonly typeChanged: boolean;
}) {
  return (
    <>
      <ValueContent value={value} />
      {typeChanged ? (
        <span className="ml-2 rounded border border-border px-1 align-top text-[10px] leading-4 text-muted-foreground">
          {jsonType(value)}
        </span>
      ) : null}
    </>
  );
}

function VersionRow({
  side,
  version,
  children,
}: {
  readonly side: Side | undefined;
  readonly version: number | undefined;
  readonly children: ReactNode;
}) {
  const border = side ? SIDE_STYLE[side].border : 'border-transparent text-muted-foreground';
  return (
    <div className={`grid grid-cols-[40px_minmax(0,1fr)] gap-x-2 border-l-2 py-0.5 pl-2 ${border}`}>
      <span className="font-mono text-[11px] text-muted-foreground">
        {version === undefined ? '' : `v${version}`}
      </span>
      <div className="min-w-0 [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

function lineSide(line: TextLine): Side | undefined {
  if (line.kind === 'removed') return 'before';
  if (line.kind === 'added') return 'after';
  return undefined;
}

function TextDiff({
  before,
  after,
  pair,
}: {
  readonly before: string;
  readonly after: string;
  readonly pair: VersionPair;
}) {
  const sections = collapseUnchanged(
    diffText(before, after),
    (line) => line.kind !== 'unchanged',
    FIELD_TEXT_CONTEXT,
  );
  return (
    <div className="space-y-px">
      <CollapsibleRows
        sections={sections}
        renderRow={(line, key) => {
          const side = lineSide(line);
          return (
            <VersionRow
              key={key}
              side={side}
              version={side === undefined ? undefined : pair[side].number}
            >
              <span className="whitespace-pre-wrap">
                <Fragments fragments={line.fragments} side={side ?? 'after'} />
              </span>
            </VersionRow>
          );
        }}
        renderExpander={(count, expand, key) => (
          <button
            key={key}
            type="button"
            className="rounded-sm py-0.5 pl-[52px] text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
            onClick={expand}
          >
            {unchangedLinesLabel(count)}
          </button>
        )}
      />
    </div>
  );
}

function ChangeValues({
  change,
  pair,
}: {
  readonly change: ValueChange;
  readonly pair: VersionPair;
}) {
  if (change.kind === 'added') {
    return (
      <VersionRow side="after" version={pair.after.number}>
        <ValueText value={change.after} typeChanged={false} />
      </VersionRow>
    );
  }
  if (change.kind === 'removed') {
    return (
      <VersionRow side="before" version={pair.before.number}>
        <ValueText value={change.before} typeChanged={false} />
      </VersionRow>
    );
  }
  // Empty text is shown as a literal, so only non-empty text is diffed.
  if (
    typeof change.before === 'string' &&
    typeof change.after === 'string' &&
    change.before &&
    change.after
  ) {
    return <TextDiff before={change.before} after={change.after} pair={pair} />;
  }
  const typeChanged = jsonType(change.before) !== jsonType(change.after);
  return (
    <div className="space-y-px">
      <VersionRow side="before" version={pair.before.number}>
        <ValueText value={change.before} typeChanged={typeChanged} />
      </VersionRow>
      <VersionRow side="after" version={pair.after.number}>
        <ValueText value={change.after} typeChanged={typeChanged} />
      </VersionRow>
    </div>
  );
}

// Additions and removals are tagged; a change is the default reading.
function KindTag({ kind }: { readonly kind: ValueChange['kind'] }) {
  if (kind === 'changed') return null;
  return (
    <span
      className={`ml-2 text-[10px] font-semibold tracking-wide uppercase ${SIDE_STYLE[kind === 'added' ? 'after' : 'before'].text}`}
    >
      {kind === 'added' ? 'Added' : 'Removed'}
    </span>
  );
}

// JavaScript-style path. Keys that are not plain identifiers are quoted, so `a["b.c"]` and
// `a.b.c` stay distinct.
function formatPath(name: string, path: ValuePath): string {
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') return `${formatted}[${segment}]`;
    if (/^[A-Za-z_$][\w$]*$/.test(segment)) return `${formatted}.${segment}`;
    return `${formatted}[${JSON.stringify(segment)}]`;
  }, name);
}

function ChangedValueRow({
  value,
  pair,
}: {
  readonly value: ChangedValue;
  readonly pair: VersionPair;
}) {
  const [first] = value.changes;
  const wholeValue = value.changes.length === 1 && first?.path.length === 0 ? first : undefined;
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-4 px-3 py-3">
      <dt className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {value.name}
        {wholeValue ? <KindTag kind={wholeValue.kind} /> : null}
      </dt>
      <dd className="m-0 min-w-0 space-y-3 text-xs leading-5 text-foreground">
        {value.changes.map((change) => {
          return (
            <div key={JSON.stringify(change.path)}>
              {wholeValue ? null : (
                <div className="mb-1 font-mono text-[11px] text-muted-foreground">
                  {formatPath(value.name, change.path)}
                  <KindTag kind={change.kind} />
                </div>
              )}
              <ChangeValues change={change} pair={pair} />
            </div>
          );
        })}
      </dd>
    </div>
  );
}

function ChangedValuesGroup({
  title,
  emptyMessage,
  values,
  pair,
}: {
  readonly title: string;
  readonly emptyMessage: string;
  readonly values: readonly ChangedValue[];
  readonly pair: VersionPair;
}) {
  return (
    <section className="mt-3 first:mt-0" aria-label={title}>
      <h3 className="mb-2 flex items-baseline gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
        {title}
        {values.length > 0 ? (
          <span className="font-normal tracking-normal normal-case">{values.length} changed</span>
        ) : null}
      </h3>
      {values.length === 0 ? (
        <p className="border-y border-border px-3 py-3 text-xs text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <dl className="m-0 divide-y divide-border border-y border-border">
          {values.map((value) => (
            <ChangedValueRow key={value.name} value={value} pair={pair} />
          ))}
        </dl>
      )}
    </section>
  );
}

/** Differing content fields and technical metadata, grouped like the Fields preview. */
export function FieldsComparison({
  comparison,
  pair,
}: {
  readonly comparison: ContentItemComparison;
  readonly pair: VersionPair;
}) {
  return (
    <div className="mt-3 space-y-6">
      <ChangedValuesGroup
        title="Content fields"
        emptyMessage="No content field differences between these versions."
        values={comparison.fields}
        pair={pair}
      />
      <ChangedValuesGroup
        title="Technical metadata"
        emptyMessage="No technical metadata differences between these versions."
        values={comparison.metadata}
        pair={pair}
      />
    </div>
  );
}

function RawJsonCells({
  line,
  side,
  changed,
}: {
  readonly line: NumberedLine | undefined;
  readonly side: Side;
  readonly changed: boolean;
}) {
  const marked = changed && line !== undefined;
  const tone = marked ? SIDE_STYLE[side].line : '';
  return (
    <>
      <td
        className={`border-r border-border pr-2 text-right align-top text-muted-foreground/70 select-none ${tone}`}
      >
        {line?.number}
      </td>
      <td className={`text-center align-top text-muted-foreground select-none ${tone}`}>
        {marked ? SIDE_STYLE[side].marker : ''}
      </td>
      <td
        className={`pr-3 align-top whitespace-pre-wrap text-code-content [overflow-wrap:anywhere] ${tone} ${side === 'before' ? 'border-r border-border' : ''}`}
      >
        {line ? <Fragments fragments={line.fragments} side={side} /> : null}
      </td>
    </>
  );
}

/** Side-by-side code diff of the complete raw data of two versions. */
export function RawJsonComparison({ pair }: { readonly pair: VersionPair }) {
  const rows = diffRawJson(pair.before.item.raw, pair.after.item.raw);
  const removed = rows.filter((row) => row.changed && row.before).length;
  const added = rows.filter((row) => row.changed && row.after).length;
  const sections = collapseUnchanged(rows, (row) => row.changed, RAW_JSON_CONTEXT);

  // Clipping, unlike scrolling, keeps the header sticky within the comparison pane.
  return (
    <div className="mt-3 overflow-clip rounded-lg border border-border bg-background">
      <table
        className="w-full table-fixed border-collapse font-mono text-[11px] leading-5"
        aria-label="Raw JSON comparison"
      >
        <colgroup>
          <col className="w-[38px]" />
          <col className="w-[22px]" />
          <col />
          <col className="w-[38px]" />
          <col className="w-[22px]" />
          <col />
        </colgroup>
        {/* Sticky cells leave collapsed borders behind, so their dividers are inset shadows. The
            negative offset cancels the padding of the scrolling comparison pane in ItemDetails. */}
        <thead className="font-sans text-xs">
          <tr>
            <th
              colSpan={3}
              className="sticky -top-5 z-10 md:-top-6 bg-surface-header px-3 py-2 text-left font-semibold shadow-[inset_-1px_-1px_0_var(--color-border)]"
            >
              <span className="flex justify-between">
                Before · version {pair.before.number}
                <span className={`font-mono font-normal ${SIDE_STYLE.before.text}`}>
                  {SIDE_STYLE.before.marker}
                  {removed}
                </span>
              </span>
            </th>
            <th
              colSpan={3}
              className="sticky -top-5 z-10 md:-top-6 bg-surface-header px-3 py-2 text-left font-semibold shadow-[inset_0_-1px_0_var(--color-border)]"
            >
              <span className="flex justify-between">
                After · version {pair.after.number}
                <span className={`font-mono font-normal ${SIDE_STYLE.after.text}`}>
                  {SIDE_STYLE.after.marker}
                  {added}
                </span>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {added + removed === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-4 font-sans text-xs text-muted-foreground">
                The raw data of these versions is identical apart from property order and
                formatting.
              </td>
            </tr>
          ) : (
            <CollapsibleRows<RawJsonRow>
              sections={sections}
              renderRow={(row, key) => (
                <tr key={key} className="border-b border-divider-subtle last:border-b-0">
                  <RawJsonCells line={row.before} side="before" changed={row.changed} />
                  <RawJsonCells line={row.after} side="after" changed={row.changed} />
                </tr>
              )}
              renderExpander={(count, expand, key) => (
                <tr key={key} className="border-b border-divider-subtle">
                  <td colSpan={6} className="bg-surface-header/60 p-0">
                    <button
                      type="button"
                      className="w-full px-3 py-1 text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
                      onClick={expand}
                    >
                      {unchangedLinesLabel(count)}
                    </button>
                  </td>
                </tr>
              )}
            />
          )}
        </tbody>
      </table>
    </div>
  );
}
