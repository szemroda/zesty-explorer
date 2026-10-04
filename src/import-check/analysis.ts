// Predicts what Zesty's Import CSV would do with a file, without writing anything.
// "Likely" and "possible" findings predict Instances API rejections, whose rules are not public.
import type { CollectionField, CollectionSchema, ContentItem, ItemZuid } from '../domain';
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
  readonly column: string;
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

/** How Zesty treats a column: `shadowed` means a later column has the same header. */
export type ColumnMapping =
  | { readonly status: 'mapped'; readonly field: CollectionField }
  | { readonly status: 'path-part' }
  | { readonly status: 'unmapped' }
  | { readonly status: 'shadowed' };

export type ColumnCheck = ColumnMapping & {
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

/** Matches each header to a field by reference name or label, like a careful user would. */
function mapColumns(header: readonly string[], schema: CollectionSchema): ColumnMapping[] {
  const byName = new Map<string, CollectionField>();
  for (const field of schema.fields) {
    byName.set(field.name.toLowerCase(), field);
    byName.set(field.label.toLowerCase(), field);
  }
  const lastIndex = new Map<string, number>();
  header.forEach((name, index) => lastIndex.set(name, index));
  return header.map((name, index) => {
    // Zesty keys each row by header name, so an earlier column with the same name is lost.
    if (lastIndex.get(name) !== index) return { status: 'shadowed' };
    const normalized = normalizeHeader(name);
    const field = byName.get(normalized);
    if (field) return { status: 'mapped', field };
    if (pathPartHeaders.has(normalized)) return { status: 'path-part' };
    return { status: 'unmapped' };
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
  if (field.options && !field.options.map(String).includes(trimmed)) {
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
    fix: 'Add a column for the field, named like its reference name or label.',
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
  const mapping = mapColumns(parsed.header, schema);
  const pathIndex = mapping.findIndex((column) => column.status === 'path-part');
  const pathPartColumn = pathIndex >= 0 ? parsed.header[pathIndex] : undefined;
  // Zesty cannot fill a required field that no column maps to, so every row lacks it.
  const unmappedRequired = schema.fields.filter(
    (field) =>
      field.required &&
      !mapping.some((column) => column.status === 'mapped' && column.field === field),
  );
  const missingRequired: RowIssue[] = unmappedRequired.map((field) => ({
    code: 'required-missing',
    column: field.name,
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
    mapping.forEach((column, columnIndex) => {
      if (column.status !== 'mapped') return;
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
    ...mapping[index]!,
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
