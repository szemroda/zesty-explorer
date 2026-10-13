// Predicts what Zesty's Import CSV would do with a file, without writing anything.
// "Likely" and "possible" findings predict Instances API rejections, whose rules are not public.
import type {
  CollectionField,
  CollectionSchema,
  ContentItem,
  FieldZuid,
  ItemZuid,
} from '../domain';
import type { CsvRecord, FileProblem, ParsedCsv } from './csv';

export type Certainty = 'likely' | 'possible';

export type RowIssueCode =
  | 'required-missing'
  | 'required-empty'
  | 'path-empty'
  | 'path-duplicate'
  | 'path-in-zesty'
  | 'relationship-not-zuid'
  | 'relationship-unknown'
  | 'image-not-zuid'
  | 'number-invalid'
  | 'date-invalid'
  | 'boolean-invalid'
  | 'option-unknown';

export interface RowIssue {
  readonly code: RowIssueCode;
  /** The header of the column the issue is in; absent when no column maps to the field. */
  readonly column?: string;
  readonly value: string;
  readonly message: string;
  readonly certainty: Certainty;
  /** Another row involved, e.g. the first row with the same path part. */
  readonly relatedRow?: number;
}

/** `rejected`: Zesty will most likely refuse the row. `at-risk`: it may. */
export type RowOutcome = 'created' | 'at-risk' | 'rejected';

export interface RowCheck {
  /** 1-based data row, counted like Zesty counts records (blank rows excluded). */
  readonly row: number;
  readonly record: CsvRecord;
  readonly values: Readonly<Record<string, string>>;
  readonly pathPart?: string;
  readonly issues: readonly RowIssue[];
  /** The issue that decides the outcome: the first `likely` one, else the first one. */
  readonly primary?: RowIssue;
  readonly outcome: RowOutcome;
}

/**
 * The choices made in Zesty's import screen. Zesty keys them by header, so columns that share a
 * header share a choice.
 */
export interface ImportMapping {
  /** The field each column fills; a header that is left out is not imported. */
  readonly fields: ReadonlyMap<string, FieldZuid>;
  /** The column Zesty turns into each page's path part. */
  readonly pathPart: string | undefined;
}

/** How Zesty treats a column: `shadowed` means a later column has the same header. */
export type ColumnUse =
  | { readonly status: 'shadowed' }
  | {
      readonly status: 'kept';
      /** The field the column fills, if any. */
      readonly field: CollectionField | undefined;
      /** The column is the path part. */
      readonly pathPart: boolean;
    };

/** Zesty drops a column's values when a later column shadows it or it fills nothing. */
export const isDropped = (column: ColumnUse) =>
  column.status === 'shadowed' || (!column.field && !column.pathPart);

export type ColumnCheck = ColumnUse & {
  readonly index: number;
  readonly header: string;
  readonly filled: number;
};

export interface ReasonGroup {
  readonly code: RowIssueCode;
  readonly title: string;
  readonly fix: string;
  readonly certainty: Certainty;
  readonly rows: readonly RowCheck[];
}

export interface CountFunnel {
  /** Lines after the header, as an editor or `wc -l` counts them. */
  readonly dataLines: number;
  /** Extra lines taken by quoted cells that contain line breaks. */
  readonly continuationLines: number;
  readonly skippedBlankLines: number;
  readonly rejected: number;
  readonly atRisk: number;
  /** Items expected to be created, counting at-risk rows as created. */
  readonly created: number;
}

export interface ImportCheck {
  readonly fileName: string;
  readonly parsed: ParsedCsv;
  readonly schema: CollectionSchema;
  readonly mapping: ImportMapping;
  readonly fileRejected: boolean;
  readonly fileProblems: readonly FileProblem[];
  readonly columns: readonly ColumnCheck[];
  readonly rows: readonly RowCheck[];
  readonly funnel: CountFunnel;
  readonly reasons: readonly ReasonGroup[];
  readonly multilineRows: readonly RowCheck[];
  /** Rows with U+FFFD, which is what text saved in another encoding than UTF-8 turns into. */
  readonly unreadableTextRows: readonly RowCheck[];
  /** False when some existing or related items couldn't be read, so some values went unchecked. */
  readonly zestyDataComplete: boolean;
}

export interface ImportCheckInput {
  readonly fileName: string;
  readonly parsed: ParsedCsv;
  readonly mapping: ImportMapping;
  readonly schema: CollectionSchema;
  readonly modelType: string;
  readonly existingItems: readonly ContentItem[];
  /** Item ZUIDs of each related collection, by related model ZUID; incomplete ones are left out. */
  readonly relatedItems: ReadonlyMap<string, ReadonlySet<string>>;
  readonly zestyDataComplete: boolean;
}

const pathPartHeaders = new Set(['path', 'path_part', 'pathpart', 'path part', 'slug', 'url']);

/** Zesty Manager's own path-part transform; dashes are neither collapsed nor trimmed. */
export function zestyPathPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-zA-Z0-9]/g, '-');
}

const normalizeHeader = (value: string) => value.trim().toLowerCase();

/**
 * Suggests a mapping like a careful user would choose it: each column to the field with that
 * reference name or label, and a column named like a slug to the path part. Zesty itself
 * starts every column at “none”.
 */
export function suggestMapping(
  header: readonly string[],
  schema: CollectionSchema,
  modelType: string,
): ImportMapping {
  const byName = new Map<string, CollectionField>();
  for (const field of schema.fields) {
    byName.set(field.name.toLowerCase(), field);
    byName.set(field.label.toLowerCase(), field);
  }
  const fields = new Map<string, FieldZuid>();
  let pathPart: string | undefined;
  for (const name of header) {
    const normalized = normalizeHeader(name);
    const field = byName.get(normalized);
    if (field && ![...fields.values()].includes(field.id)) {
      fields.set(name, field.id);
      continue;
    }
    if (modelType === 'pageset' && pathPartHeaders.has(normalized)) pathPart ??= name;
  }
  return { fields, pathPart };
}

/**
 * Whether Zesty can use a header as the path part: its Path Part select stores “none” for no
 * choice, and ignores an empty header.
 */
export const canBePathPart = (header: string) => header !== '' && header !== 'none';

/** Maps a column to a field, or to none; the field is taken from any column that had it. */
export function mapColumn(
  mapping: ImportMapping,
  header: string,
  field: FieldZuid | undefined,
): ImportMapping {
  const fields = new Map([...mapping.fields].filter(([, mapped]) => mapped !== field));
  if (field) fields.set(header, field);
  else fields.delete(header);
  return { ...mapping, fields };
}

function columnUses(
  header: readonly string[],
  schema: CollectionSchema,
  mapping: ImportMapping,
): ColumnUse[] {
  const lastIndex = new Map<string, number>();
  header.forEach((name, index) => lastIndex.set(name, index));
  return header.map((name, index) => {
    // Zesty keys each row by header name, so an earlier column with the same name is lost.
    if (lastIndex.get(name) !== index) return { status: 'shadowed' };
    const fieldId = mapping.fields.get(name);
    const field = schema.fields.find((candidate) => candidate.id === fieldId);
    return { status: 'kept', field, pathPart: mapping.pathPart === name };
  });
}

const zuidPattern = /^7-[a-z0-9-]+$/i;
const mediaPattern = /^3-[a-z0-9-]+$/i;
// Dates as the message tells users to write them, optionally with a time.
const datePattern = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/;
const booleanValues = new Set(['0', '1', 'true', 'false']);

function fieldIssues(
  field: CollectionField,
  column: string,
  value: string,
  relatedItems: ImportCheckInput['relatedItems'],
): RowIssue[] {
  const trimmed = value.trim();
  if (trimmed === '') {
    if (!field.required) return [];
    return [
      {
        code: 'required-empty',
        column,
        value,
        certainty: 'likely',
        message: `${field.label} is required but empty.`,
      },
    ];
  }
  const datatype = (field.datatype ?? '').toLowerCase();
  if (field.kind === 'relationship') {
    const values = trimmed.split(',').map((part) => part.trim());
    const notZuid = values.find((part) => !zuidPattern.test(part));
    if (notZuid !== undefined) {
      return [
        {
          code: 'relationship-not-zuid',
          column,
          value,
          certainty: 'likely',
          message: `“${notZuid}” is not an item ZUID. ${field.label} needs ZUIDs like 7-…`,
        },
      ];
    }
    const known = field.relatedModelZuid ? relatedItems.get(field.relatedModelZuid) : undefined;
    const unknown = known ? values.find((part) => !known.has(part)) : undefined;
    if (unknown === undefined) return [];
    return [
      {
        code: 'relationship-unknown',
        column,
        value,
        certainty: 'likely',
        message: `${unknown} is not an item of the related collection.`,
      },
    ];
  }
  if (datatype === 'images') {
    const bad = trimmed.split(',').find((part) => !mediaPattern.test(part.trim()));
    if (bad === undefined) return [];
    return [
      {
        code: 'image-not-zuid',
        column,
        value,
        certainty: 'possible',
        message: `“${bad}” is not a media ZUID. Upload the file to Media and use its 3-… ZUID.`,
      },
    ];
  }
  if (field.kind === 'number') {
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return [];
    return [
      {
        code: 'number-invalid',
        column,
        value,
        certainty: 'possible',
        message: `“${trimmed}” is not a number Zesty accepts${trimmed.includes(',') ? ' (use a dot for decimals)' : ''}.`,
      },
    ];
  }
  if (field.kind === 'date') {
    if (datePattern.test(trimmed) && !Number.isNaN(Date.parse(trimmed.replace(' ', 'T')))) {
      return [];
    }
    return [
      {
        code: 'date-invalid',
        column,
        value,
        certainty: 'possible',
        message: `“${trimmed}” is not a date Zesty can read. Use YYYY-MM-DD.`,
      },
    ];
  }
  if (field.kind === 'boolean') {
    if (booleanValues.has(trimmed.toLowerCase())) return [];
    return [
      {
        code: 'boolean-invalid',
        column,
        value,
        certainty: 'possible',
        message: `“${trimmed}” is not a yes/no value. Use 1 or 0.`,
      },
    ];
  }
  if (field.options && !field.options.some((option) => String(option.value) === trimmed)) {
    return [
      {
        code: 'option-unknown',
        column,
        value,
        certainty: 'possible',
        message: `“${trimmed}” is not one of ${field.label}'s options.`,
      },
    ];
  }
  return [];
}

/** How each issue is named in the summary, and how to fix it. */
export const issueCopy: Readonly<
  Record<RowIssueCode, { readonly title: string; readonly fix: string }>
> = {
  'required-missing': {
    title: 'Required field has no column',
    fix: 'Choose a column for the field in its header, or add one to the file.',
  },
  'required-empty': {
    title: 'Required field is empty',
    fix: 'Fill the cell, or leave the row out on purpose.',
  },
  'path-empty': {
    title: 'Empty path part',
    fix: 'Give each row a value in the path column.',
  },
  'path-duplicate': {
    title: 'Same URL as an earlier row',
    fix: 'Make these values unique once Zesty turns them into URLs.',
  },
  'path-in-zesty': {
    title: 'URL already used in Zesty',
    fix: 'Remove rows already imported, or change their path part.',
  },
  'relationship-not-zuid': {
    title: 'Relationship holds a name, not a ZUID',
    fix: 'Replace names with the related item ZUIDs (7-…).',
  },
  'relationship-unknown': {
    title: 'Related item does not exist',
    fix: 'Check the ZUID; the related item may have been deleted or be in another instance.',
  },
  'image-not-zuid': {
    title: 'Image is a URL or file name',
    fix: 'Upload the images to Media first, then use their 3-… ZUIDs.',
  },
  'number-invalid': {
    title: 'Not a number',
    fix: 'Use digits with a dot for decimals, e.g. 4.5.',
  },
  'date-invalid': {
    title: 'Unreadable date',
    fix: 'Use YYYY-MM-DD.',
  },
  'boolean-invalid': {
    title: 'Not a yes/no value',
    fix: 'Use 1 or 0.',
  },
  'option-unknown': {
    title: 'Not a dropdown option',
    fix: 'Use one of the option keys.',
  },
};

function rowOutcome(primary: RowIssue | undefined, fileRejected: boolean): RowOutcome {
  if (fileRejected) return 'rejected';
  if (!primary) return 'created';
  return primary.certainty === 'likely' ? 'rejected' : 'at-risk';
}

const replacementCharacter = String.fromCodePoint(0xfffd);

export function checkImport(input: ImportCheckInput): ImportCheck {
  const { parsed, schema, existingItems, relatedItems } = input;
  const fileRejected = parsed.fileProblems.length > 0;
  const isPageset = input.modelType === 'pageset';
  const { mapping } = input;
  const uses = columnUses(parsed.header, schema, mapping);
  const pathPartColumn = mapping.pathPart;
  // Zesty cannot fill a required field that no column maps to, so every row lacks it.
  const unmappedRequired = schema.fields.filter(
    (field) =>
      field.required && !uses.some((column) => column.status === 'kept' && column.field === field),
  );
  const missingRequired: RowIssue[] = unmappedRequired.map((field) => ({
    code: 'required-missing',
    value: '',
    certainty: 'likely',
    message: `${field.label} is required, but no column maps to it.`,
  }));

  // Imported pages have no parent, and a path part only has to be unique under its parent.
  const existingPaths = new Map<string, ItemZuid>();
  for (const item of existingItems) {
    const web = item.raw.web;
    if (!web || typeof web !== 'object') continue;
    const pathPart = 'pathPart' in web ? web.pathPart : undefined;
    const parent = 'parentZUID' in web ? web.parentZUID : undefined;
    const atRoot = parent === undefined || parent === null || parent === '' || parent === '0';
    if (typeof pathPart === 'string' && atRoot) existingPaths.set(pathPart, item.id);
  }

  const firstRowByPath = new Map<string, number>();
  const rows: RowCheck[] = parsed.records.map((record, index) => {
    const row = index + 1;
    // Keyed by header like Zesty's rows, so a repeated header keeps its last column.
    const values = Object.fromEntries(
      parsed.header.map((name, column) => [name, record.cells[column] ?? '']),
    );
    const issues: RowIssue[] = [...missingRequired];
    uses.forEach((column, columnIndex) => {
      if (column.status !== 'kept' || !column.field) return;
      const header = parsed.header[columnIndex]!;
      issues.push(...fieldIssues(column.field, header, values[header] ?? '', relatedItems));
    });

    let pathPart: string | undefined;
    let existingItem: ItemZuid | undefined;
    if (isPageset && pathPartColumn !== undefined) {
      const source = values[pathPartColumn] ?? '';
      pathPart = zestyPathPart(source);
      existingItem = existingPaths.get(pathPart);
      const earlier = firstRowByPath.get(pathPart);
      if (pathPart === '') {
        issues.push({
          code: 'path-empty',
          column: pathPartColumn,
          value: source,
          certainty: 'likely',
          message: 'The path part is empty.',
        });
      } else if (existingItem) {
        issues.push({
          code: 'path-in-zesty',
          column: pathPartColumn,
          value: source,
          certainty: 'likely',
          message: `“${pathPart}” already belongs to ${existingItem}.`,
        });
      } else if (earlier !== undefined) {
        issues.push({
          code: 'path-duplicate',
          column: pathPartColumn,
          value: source,
          certainty: 'likely',
          message: `“${source}” becomes “${pathPart}”, like row ${earlier}.`,
          relatedRow: earlier,
        });
      } else if (!issues.some((issue) => issue.certainty === 'likely')) {
        // Only a row that will be created takes its URL away from later rows.
        firstRowByPath.set(pathPart, row);
      }
    }

    const primary = issues.find((issue) => issue.certainty === 'likely') ?? issues[0];
    return {
      row,
      record,
      values,
      issues,
      outcome: rowOutcome(primary, fileRejected),
      ...(primary ? { primary } : {}),
      ...(pathPart !== undefined ? { pathPart } : {}),
    };
  });

  const groups = new Map<RowIssueCode, { certainty: Certainty; rows: RowCheck[] }>();
  for (const row of rows) {
    // A row counts once, under its primary issue.
    const primary = row.primary;
    if (!primary) continue;
    const group = groups.get(primary.code) ?? { certainty: primary.certainty, rows: [] };
    group.rows.push(row);
    groups.set(primary.code, group);
  }
  const reasons: ReasonGroup[] = [...groups.entries()]
    .map(([code, group]) => ({ code, ...issueCopy[code], ...group }))
    .toSorted(
      (a, b) =>
        Number(a.certainty === 'possible') - Number(b.certainty === 'possible') ||
        b.rows.length - a.rows.length,
    );

  const columns: ColumnCheck[] = parsed.header.map((header, index) => ({
    ...uses[index]!,
    index,
    header,
    filled: parsed.records.filter((record) => (record.cells[index] ?? '').trim() !== '').length,
  }));

  const multilineRows = rows.filter((row) => row.record.lineSpan > 1);
  const fileProblems = parsed.fileProblems;
  const rejected = rows.filter((row) => row.outcome === 'rejected').length;
  const atRisk = rows.filter((row) => row.outcome === 'at-risk').length;
  return {
    fileName: input.fileName,
    parsed,
    schema,
    mapping,
    fileRejected,
    fileProblems,
    columns,
    rows,
    funnel: {
      dataLines: Math.max(0, parsed.physicalLines - 1),
      continuationLines: multilineRows.reduce((sum, row) => sum + row.record.lineSpan - 1, 0),
      skippedBlankLines: parsed.skippedBlankLines.length,
      rejected: fileRejected ? 0 : rejected,
      atRisk: fileRejected ? 0 : atRisk,
      created: fileRejected ? 0 : rows.length - rejected,
    },
    reasons,
    multilineRows,
    unreadableTextRows: rows.filter((row) =>
      row.record.cells.some((cell) => cell.includes(replacementCharacter)),
    ),
    zestyDataComplete: input.zestyDataComplete,
  };
}

export function describeFileProblem(problem: FileProblem): string {
  if (problem.kind === 'column-count') {
    return `Line ${problem.line} has ${problem.found} columns; the header has ${problem.expected}.`;
  }
  if (problem.kind === 'stray-quote') {
    return `Line ${problem.line} has a quote inside an unquoted cell or after a closing quote.`;
  }
  return `A quote opened on line ${problem.line} is never closed.`;
}
