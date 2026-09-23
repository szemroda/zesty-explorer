import { diffArrays, diffWordsWithSpace } from 'diff';
import microdiff, { type Difference } from 'microdiff';
import type { ContentItem } from '../domain';
import type { VersionPreviewOption } from './item-version-preview';

// Version comparison model, independent of React. Structural differences come from microdiff
// for both Fields and Raw JSON; changed text lines and fragments come from JsDiff.

/** Object keys and array positions leading to a nested value. Empty for the whole value. */
export type ValuePath = readonly (string | number)[];

export type ValueChange =
  | { readonly kind: 'added'; readonly path: ValuePath; readonly after: unknown }
  | { readonly kind: 'removed'; readonly path: ValuePath; readonly before: unknown }
  | {
      readonly kind: 'changed';
      readonly path: ValuePath;
      readonly before: unknown;
      readonly after: unknown;
    };

/** A content field or technical metadata value that differs, with changes relative to it. */
export interface ChangedValue {
  readonly name: string;
  readonly changes: readonly ValueChange[];
}

export interface ContentItemComparison {
  readonly fields: readonly ChangedValue[];
  readonly metadata: readonly ChangedValue[];
}

/** Text shown on one side of a diff; highlighted text differs from the paired line. */
export interface TextFragment {
  readonly text: string;
  readonly highlighted: boolean;
}

export interface TextLine {
  readonly kind: 'unchanged' | 'removed' | 'added';
  readonly fragments: readonly TextFragment[];
}

export interface NumberedLine {
  readonly number: number;
  readonly fragments: readonly TextFragment[];
}

/** One side-by-side raw JSON row. A side is absent where the other version has an extra line. */
export interface RawJsonRow {
  readonly changed: boolean;
  readonly before?: NumberedLine;
  readonly after?: NumberedLine;
}

export interface DiffSection<Row> {
  readonly hidden: boolean;
  readonly rows: readonly Row[];
}

export interface VersionNumberPair {
  readonly before: number;
  readonly after: number;
}

export interface VersionPair {
  readonly before: VersionPreviewOption;
  readonly after: VersionPreviewOption;
}

// Beyond these edit distances a diff is too costly to compute and too scattered to read.
const MAX_LINE_EDITS = 2_000;
const MAX_WORD_EDITS = 500;
// Collapsing fewer unchanged rows than this saves no space.
const MIN_HIDDEN_ROWS = 4;

function valueChange(difference: Difference, path: ValuePath): ValueChange {
  if (difference.type === 'CREATE') return { kind: 'added', path, after: difference.value };
  if (difference.type === 'REMOVE') return { kind: 'removed', path, before: difference.oldValue };
  return { kind: 'changed', path, before: difference.oldValue, after: difference.value };
}

function compareNamedValues(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): readonly ChangedValue[] {
  const changesByName = new Map<string, ValueChange[]>();
  for (const difference of microdiff(before, after, { cyclesFix: false })) {
    const [name, ...path] = difference.path;
    const key = String(name);
    const changes = changesByName.get(key) ?? [];
    changes.push(valueChange(difference, path));
    changesByName.set(key, changes);
  }
  return [...changesByName].map(([name, changes]) => ({ name, changes }));
}

/** Content fields and technical metadata that differ between two saved versions. */
export function compareContentItems(
  before: ContentItem,
  after: ContentItem,
): ContentItemComparison {
  return {
    fields: compareNamedValues(before.fields, after.fields),
    metadata: compareNamedValues(before.metadata, after.metadata),
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** One-line description of how two versions differ, for the comparison heading. */
export function describeComparison(comparison: ContentItemComparison): string {
  const fields =
    comparison.fields.length === 0
      ? 'No content field differences'
      : plural(comparison.fields.length, 'content field differs', 'content fields differ');
  const metadata =
    comparison.metadata.length === 0
      ? 'technical metadata is identical'
      : plural(
          comparison.metadata.length,
          'technical metadata value differs',
          'technical metadata values differ',
        );
  return `${fields} · ${metadata}`;
}

function unhighlighted(text: string): readonly TextFragment[] {
  return [{ text, highlighted: false }];
}

// Joins adjacent fragments with the same highlight, including whitespace between two changes.
function mergeFragments(fragments: readonly TextFragment[]): readonly TextFragment[] {
  const merged: TextFragment[] = [];
  fragments.forEach((fragment, index) => {
    const highlighted =
      fragment.highlighted ||
      (fragment.text.trim() === '' &&
        fragments[index - 1]?.highlighted === true &&
        fragments[index + 1]?.highlighted === true);
    const previous = merged.at(-1);
    if (previous?.highlighted === highlighted) {
      merged[merged.length - 1] = { text: previous.text + fragment.text, highlighted };
    } else {
      merged.push({ text: fragment.text, highlighted });
    }
  });
  return merged;
}

// Highlights changed words in a pair of lines. Lines sharing no words are left unhighlighted,
// because a highlight covering everything says nothing the line marker does not.
function pairedLineFragments(
  before: string,
  after: string,
): { readonly before: readonly TextFragment[]; readonly after: readonly TextFragment[] } {
  const changes = diffWordsWithSpace(before, after, { maxEditLength: MAX_WORD_EDITS });
  const sharesWords = changes?.some(
    (change) => !change.added && !change.removed && change.value.trim() !== '',
  );
  if (!changes || !sharesWords) {
    return { before: unhighlighted(before), after: unhighlighted(after) };
  }
  return {
    before: mergeFragments(
      changes
        .filter((change) => !change.added)
        .map((change) => ({ text: change.value, highlighted: change.removed })),
    ),
    after: mergeFragments(
      changes
        .filter((change) => !change.removed)
        .map((change) => ({ text: change.value, highlighted: change.added })),
    ),
  };
}

interface LineBlock {
  readonly changed: boolean;
  /** Set when the diff gave up, so removed and added lines do not correspond. */
  readonly unaligned?: true;
  readonly before: readonly string[];
  readonly after: readonly string[];
}

// Consecutive unchanged lines, or consecutive removed and added lines.
function lineBlocks(before: readonly string[], after: readonly string[]): readonly LineBlock[] {
  const changes = diffArrays([...before], [...after], { maxEditLength: MAX_LINE_EDITS });
  if (!changes) return [{ changed: true, unaligned: true, before, after }];

  const blocks: LineBlock[] = [];
  for (const change of changes) {
    const block: LineBlock = {
      changed: change.added || change.removed,
      before: change.added ? [] : change.value,
      after: change.removed ? [] : change.value,
    };
    const previous = blocks.at(-1);
    if (block.changed && previous?.changed) {
      blocks[blocks.length - 1] = {
        changed: true,
        before: [...previous.before, ...block.before],
        after: [...previous.after, ...block.after],
      };
    } else {
      blocks.push(block);
    }
  }
  return blocks;
}

// Fragments for each line of a changed block. The n-th removed line pairs with the n-th added one.
function changedBlockFragments(block: LineBlock): {
  readonly before: readonly (readonly TextFragment[])[];
  readonly after: readonly (readonly TextFragment[])[];
} {
  if (block.unaligned) {
    return { before: block.before.map(unhighlighted), after: block.after.map(unhighlighted) };
  }
  const pairs = Array.from(
    { length: Math.max(block.before.length, block.after.length) },
    (_, i) => {
      const before = block.before[i];
      const after = block.after[i];
      if (before !== undefined && after !== undefined) return pairedLineFragments(before, after);
      return {
        ...(before !== undefined ? { before: unhighlighted(before) } : {}),
        ...(after !== undefined ? { after: unhighlighted(after) } : {}),
      };
    },
  );
  return {
    before: pairs.flatMap((pair) => (pair.before ? [pair.before] : [])),
    after: pairs.flatMap((pair) => (pair.after ? [pair.after] : [])),
  };
}

/** Line diff of source text, listing removed lines before added lines in each changed run. */
export function diffText(before: string, after: string): readonly TextLine[] {
  return lineBlocks(before.split('\n'), after.split('\n')).flatMap((block): TextLine[] => {
    if (!block.changed) {
      return block.after.map((line) => ({ kind: 'unchanged', fragments: unhighlighted(line) }));
    }
    const fragments = changedBlockFragments(block);
    return [
      ...fragments.before.map((line) => ({ kind: 'removed' as const, fragments: line })),
      ...fragments.after.map((line) => ({ kind: 'added' as const, fragments: line })),
    ];
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Sorted-key JSON, so property order never shows as a difference.
function canonicalJson(value: unknown): string {
  const json = JSON.stringify(
    value,
    (_key, nested: unknown) =>
      isRecord(nested)
        ? Object.fromEntries(
            Object.keys(nested)
              .toSorted()
              .map((key) => [key, nested[key]]),
          )
        : nested,
    2,
  );
  return json ?? '';
}

type PathSegment = ValuePath[number];

// Children of an object (sorted keys) or array (positions); empty for other values.
function childEntries(value: unknown): ReadonlyMap<PathSegment, unknown> {
  if (Array.isArray(value)) return new Map(value.map((child: unknown, index) => [index, child]));
  if (!isRecord(value)) return new Map();
  return new Map(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, value[key]]),
  );
}

// Positions in numeric order; keys in the code unit order used by `canonicalJson`.
function compareSegments(left: PathSegment, right: PathSegment): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (left === right) return 0;
  return String(left) < String(right) ? -1 : 1;
}

function pathKey(path: ValuePath): string {
  return JSON.stringify(path);
}

/**
 * Side-by-side rows of two raw objects printed as sorted-key JSON. microdiff decides what
 * changed, so array entries are compared by position, as in Fields.
 */
export function diffRawJson(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): readonly RawJsonRow[] {
  const differences = microdiff(before, after, { cyclesFix: false });
  const differenceAt = new Map(
    differences.map((difference) => [pathKey(difference.path), difference]),
  );
  const containsDifference = new Set(
    differences.flatMap((difference) =>
      difference.path.map((_, length) => pathKey(difference.path.slice(0, length))),
    ),
  );
  const rows: RawJsonRow[] = [];
  let beforeNumber = 0;
  let afterNumber = 0;

  function pushRows(
    changed: boolean,
    beforeLines: readonly (readonly TextFragment[])[],
    afterLines: readonly (readonly TextFragment[])[],
  ) {
    for (let index = 0; index < Math.max(beforeLines.length, afterLines.length); index++) {
      const beforeFragments = beforeLines[index];
      const afterFragments = afterLines[index];
      rows.push({
        changed,
        ...(beforeFragments
          ? { before: { number: ++beforeNumber, fragments: beforeFragments } }
          : {}),
        ...(afterFragments ? { after: { number: ++afterNumber, fragments: afterFragments } } : {}),
      });
    }
  }

  function pushUnchanged(beforeLines: readonly string[], afterLines: readonly string[]) {
    pushRows(false, beforeLines.map(unhighlighted), afterLines.map(unhighlighted));
  }

  function pushChanged(beforeLines: readonly string[], afterLines: readonly string[]) {
    const fragments = changedBlockFragments({
      changed: true,
      before: beforeLines,
      after: afterLines,
    });
    pushRows(true, fragments.before, fragments.after);
  }

  // One object property or array element, printed at `indent` with an optional trailing comma.
  function entryLines(label: string, value: unknown, indent: string, comma: boolean): string[] {
    const lines = canonicalJson(value)
      .split('\n')
      .map((line, index) => (index === 0 ? `${indent}${label}${line}` : `${indent}${line}`));
    return comma ? lines.with(-1, `${lines.at(-1)},`) : lines;
  }

  function entry(
    path: ValuePath,
    label: string,
    side: { readonly before: unknown; readonly after: unknown },
    indent: string,
    comma: { readonly before: boolean; readonly after: boolean },
  ) {
    const difference = differenceAt.get(pathKey(path));
    const beforeLines = () => entryLines(label, side.before, indent, comma.before);
    const afterLines = () => entryLines(label, side.after, indent, comma.after);
    if (difference?.type === 'CREATE') return pushChanged([], afterLines());
    if (difference?.type === 'REMOVE') return pushChanged(beforeLines(), []);
    if (difference) return pushChanged(beforeLines(), afterLines());
    if (!containsDifference.has(pathKey(path))) return pushUnchanged(beforeLines(), afterLines());

    // Both sides are objects, or both arrays, with differences inside.
    const [open, close] = Array.isArray(side.before) ? ['[', ']'] : ['{', '}'];
    pushUnchanged([`${indent}${label}${open}`], [`${indent}${label}${open}`]);
    const beforeChildren = childEntries(side.before);
    const afterChildren = childEntries(side.after);
    const segments = [...new Set([...beforeChildren.keys(), ...afterChildren.keys()])].toSorted(
      compareSegments,
    );
    const lastBefore = [...beforeChildren.keys()].at(-1);
    const lastAfter = [...afterChildren.keys()].at(-1);
    for (const segment of segments) {
      entry(
        [...path, segment],
        typeof segment === 'number' ? '' : `${JSON.stringify(segment)}: `,
        { before: beforeChildren.get(segment), after: afterChildren.get(segment) },
        `${indent}  `,
        { before: segment !== lastBefore, after: segment !== lastAfter },
      );
    }
    pushUnchanged(
      [`${indent}${close}${comma.before ? ',' : ''}`],
      [`${indent}${close}${comma.after ? ',' : ''}`],
    );
  }

  entry([], '', { before, after }, '', { before: false, after: false });
  return rows;
}

/**
 * Splits diff rows into visible sections and hidden runs of unchanged rows that lie more than
 * `context` rows away from any change.
 */
export function collapseUnchanged<Row>(
  rows: readonly Row[],
  isChanged: (row: Row) => boolean,
  context: number,
): readonly DiffSection<Row>[] {
  const changed = rows.map(isChanged);
  const nearChange = rows.map((_, index) =>
    changed.slice(Math.max(0, index - context), index + context + 1).includes(true),
  );
  const sections: DiffSection<Row>[] = [];
  let start = 0;
  while (start < rows.length) {
    let end = start;
    while (end < rows.length && nearChange[end] === nearChange[start]) end++;
    const hidden = !nearChange[start] && end - start >= MIN_HIDDEN_ROWS;
    const run = rows.slice(start, end);
    const previous = sections.at(-1);
    if (!hidden && previous && !previous.hidden) {
      sections[sections.length - 1] = { hidden: false, rows: [...previous.rows, ...run] };
    } else {
      sections.push({ hidden, rows: run });
    }
    start = end;
  }
  return sections;
}

/**
 * The versions to compare, ordered older to newer. A valid chosen pair wins; otherwise the
 * previewed version is compared with the save before it. `options` are newest first.
 */
export function resolveVersionPair(
  options: readonly VersionPreviewOption[],
  previewedNumber: number | undefined,
  chosen: VersionNumberPair | undefined,
): VersionPair | undefined {
  if (chosen && chosen.before < chosen.after) {
    const before = options.find((option) => option.number === chosen.before);
    const after = options.find((option) => option.number === chosen.after);
    if (before && after) return { before, after };
  }
  const previewedIndex = Math.max(
    0,
    options.findIndex((option) => option.number === previewedNumber),
  );
  const afterIndex = Math.min(previewedIndex, options.length - 2);
  const after = options[afterIndex];
  const before = options[afterIndex + 1];
  return before && after ? { before, after } : undefined;
}
