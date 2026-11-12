import type {
  CollectionReference,
  CollectionSchema,
  ContentItem,
  ItemZuid,
  NodePresentation,
  SortState,
} from '../domain';

const fixedMetadataKeys = new Set(['created', 'modified', 'version']);

export const columnWidthLimits = { min: 90, max: 520 } as const;
export const defaultContentColumnWidth = 190;
// The fields itemDisplayLabel names items by, in order. Their columns start wider.
const labelFieldNames = ['title', 'name'];
const labelColumnWidth = 300;

interface ColumnDefinition {
  readonly id: string;
  readonly label: string;
  readonly technical: boolean;
  readonly sortable: boolean;
  readonly defaultWidth: number;
}

export type ContentItemColumn =
  ContentValueColumn | (ColumnDefinition & { readonly kind: 'status' });

export type ContentValueColumn = ColumnDefinition & {
  readonly kind: 'value';
  /** The value is WYSIWYG HTML, shown formatted rather than as text. */
  readonly richText: boolean;
  read(item: ContentItem): unknown;
};

export function contentItemColumns(
  schema: Pick<CollectionSchema, 'fields'>,
  items: readonly ContentItem[],
): readonly ContentItemColumn[] {
  const extraMetadataKeys = [
    ...new Set(
      items.flatMap((item) =>
        Object.keys(item.metadata).filter((key) => !fixedMetadataKeys.has(key)),
      ),
    ),
  ].sort();

  return [
    technicalColumn('$id', 'ZUID', 160, (item) => item.id),
    {
      kind: 'status',
      id: '$status',
      label: 'Status',
      technical: true,
      sortable: false,
      defaultWidth: 170,
    },
    ...schema.fields.map((field) => ({
      kind: 'value' as const,
      id: field.name,
      label: field.label,
      technical: false,
      sortable: true,
      defaultWidth: labelFieldNames.includes(field.name)
        ? labelColumnWidth
        : defaultContentColumnWidth,
      richText: field.datatype?.startsWith('wysiwyg') ?? false,
      read: (item: ContentItem) => item.fields[field.name],
    })),
    technicalColumn('$created', 'Created', 180, (item) => item.metadata.created),
    technicalColumn('$modified', 'Modified', 180, (item) => item.metadata.modified),
    technicalColumn('$version', 'Version', 110, (item) => item.metadata.version),
    ...extraMetadataKeys.map((key) =>
      technicalColumn(`$meta.${key}`, key, 180, (item) => item.metadata[key]),
    ),
    technicalColumn('$raw', 'Raw JSON', 260, (item) => item.raw, false),
  ];
}

function technicalColumn(
  id: string,
  label: string,
  defaultWidth: number,
  read: (item: ContentItem) => unknown,
  sortable = true,
): ContentItemColumn {
  return {
    kind: 'value',
    id,
    label,
    technical: true,
    sortable,
    defaultWidth,
    richText: false,
    read,
  };
}

export function columnIdForSort(sort: SortState): string {
  if (sort.fieldPath[0] === 'fields' && sort.fieldPath[1]) {
    return sort.fieldPath.slice(1).join('.');
  }
  const path = sort.fieldPath.join('.');
  if (sort.fieldPath[0] === 'metadata' && sort.fieldPath[1]) {
    if (fixedMetadataKeys.has(sort.fieldPath[1]) && sort.fieldPath.length === 2) {
      return `$${sort.fieldPath[1]}`;
    }
    return `$meta.${sort.fieldPath.slice(1).join('.')}`;
  }
  return ['id', 'created', 'modified', 'version'].includes(path) ? `$${path}` : path;
}

export function sortForColumn(columnId: string, direction: SortState['direction']): SortState {
  if (columnId.startsWith('$meta.')) {
    return { fieldPath: ['metadata', columnId.slice('$meta.'.length)], direction };
  }
  if (columnId === '$id') return { fieldPath: ['id'], direction };
  if (columnId.startsWith('$')) {
    return { fieldPath: ['metadata', columnId.slice(1)], direction };
  }
  return { fieldPath: ['fields', ...columnId.split('.')], direction };
}

export function initialColumnVisibility(
  columns: readonly ContentItemColumn[],
  savedColumnIds: NodePresentation['visibleColumns'],
  statusColumnHidden = false,
): Readonly<Record<string, boolean>> {
  const usesDefaults = savedColumnIds.includes('*');
  return Object.fromEntries(
    columns.map((column) => [
      column.id,
      column.kind === 'status'
        ? !statusColumnHidden
        : usesDefaults
          ? column.id === '$id' || !column.technical
          : savedColumnIds.includes(column.id),
    ]),
  );
}

export function hiddenColumnIds(
  columns: readonly ContentItemColumn[],
  savedColumnIds: NodePresentation['visibleColumns'],
  statusColumnHidden = false,
): ReadonlySet<string> {
  const visibility = initialColumnVisibility(columns, savedColumnIds, statusColumnHidden);
  return new Set(columns.filter((column) => !visibility[column.id]).map((column) => column.id));
}

export function visibleColumnIds(
  columns: readonly ContentItemColumn[],
  visibility: Readonly<Record<string, boolean>>,
): readonly string[] {
  return columns.filter((column) => visibility[column.id] !== false).map((column) => column.id);
}

// Human-readable item name for buttons and titles; falls back to the ZUID when untitled.
export function itemDisplayLabel(item: ContentItem): string {
  const label = labelFieldNames
    .map((name) => item.fields[name])
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(formatContentValue)
    .find((text) => text !== '');
  return label ?? item.id;
}

// Zesty Manager editor page for an item; collections outside content and blocks have none.
export function managerItemUrl(
  reference: Pick<CollectionReference, 'managerBaseUrl' | 'area' | 'modelZuid'>,
  itemId: ItemZuid,
): string | undefined {
  if (reference.area === 'other') return undefined;
  return `${reference.managerBaseUrl}/${reference.area}/${reference.modelZuid}/${itemId}`;
}

export function formatContentValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '\u2014';
  if (typeof value === 'string') {
    return value
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }
  return typeof value === 'symbol' ? (value.description ?? 'Symbol') : '[Function]';
}
