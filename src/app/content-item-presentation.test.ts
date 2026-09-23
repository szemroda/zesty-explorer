import { describe, expect, it } from 'vitest';
import type { CollectionSchema, ContentItem, SortState } from '../domain';
import {
  columnIdForSort,
  contentItemColumns,
  formatContentValue,
  hiddenColumnIds,
  initialColumnVisibility,
  sortForColumn,
  visibleColumnIds,
} from './content-item-presentation';

const schema = {
  fields: [
    { id: '12-title', name: 'title', label: 'Title', kind: 'text' },
    { id: '12-score', name: 'score', label: 'Score', kind: 'number' },
  ],
} satisfies Pick<CollectionSchema, 'fields'>;

const item = {
  id: '7-item',
  fields: { title: '<p>Hello</p>', score: 2 },
  metadata: {
    created: '2026-01-01',
    modified: '2026-01-02',
    version: 3,
    workflowStatus: 'ready',
  },
  raw: { title: '<p>Hello</p>' },
} satisfies ContentItem;

describe('content item presentation', () => {
  it('describes content fields and all technical metadata once', () => {
    const columns = contentItemColumns(schema, [item]);

    expect(columns.map(({ id, label, technical }) => ({ id, label, technical }))).toEqual([
      { id: '$id', label: 'ZUID', technical: true },
      { id: '$status', label: 'Status', technical: true },
      { id: 'title', label: 'Title', technical: false },
      { id: 'score', label: 'Score', technical: false },
      { id: '$created', label: 'Created', technical: true },
      { id: '$modified', label: 'Modified', technical: true },
      { id: '$version', label: 'Version', technical: true },
      { id: '$meta.workflowStatus', label: 'workflowStatus', technical: true },
      { id: '$raw', label: 'Raw JSON', technical: true },
    ]);
    const title = columns.find((column) => column.id === 'title');
    const workflowStatus = columns.find((column) => column.id === '$meta.workflowStatus');
    expect(title?.kind === 'value' ? title.read(item) : undefined).toBe('<p>Hello</p>');
    expect(workflowStatus?.kind === 'value' ? workflowStatus.read(item) : undefined).toBe('ready');
    expect(columns.find((column) => column.id === '$raw')?.sortable).toBe(false);
  });

  it('translates sort state between persisted paths and table column ids', () => {
    const metadataSort = {
      fieldPath: ['metadata', 'workflowStatus'],
      direction: 'asc',
    } satisfies SortState;

    expect(columnIdForSort(metadataSort)).toBe('$meta.workflowStatus');
    expect(sortForColumn('$meta.workflowStatus', 'desc')).toEqual({
      fieldPath: ['metadata', 'workflowStatus'],
      direction: 'desc',
    });
    expect(sortForColumn('$modified', 'asc')).toEqual({
      fieldPath: ['metadata', 'modified'],
      direction: 'asc',
    });
    expect(sortForColumn('id', 'asc')).toEqual({
      fieldPath: ['fields', 'id'],
      direction: 'asc',
    });
    expect(columnIdForSort({ fieldPath: ['fields', 'id'], direction: 'desc' })).toBe('id');
  });

  it('applies default and explicit column visibility consistently', () => {
    const columns = contentItemColumns(schema, [item]);
    const defaults = initialColumnVisibility(columns, ['*']);

    expect(visibleColumnIds(columns, defaults)).toEqual(['$id', '$status', 'title', 'score']);
    expect(hiddenColumnIds(columns, ['*'])).toContain('$raw');
    expect(visibleColumnIds(columns, initialColumnVisibility(columns, ['title', '$id']))).toEqual([
      '$id',
      '$status',
      'title',
    ]);
    expect(visibleColumnIds(columns, initialColumnVisibility(columns, ['title']))).toEqual([
      '$status',
      'title',
    ]);
    expect(visibleColumnIds(columns, initialColumnVisibility(columns, ['title'], true))).toEqual([
      'title',
    ]);
  });

  it('formats content values for table cells', () => {
    expect(formatContentValue('<p>Hello</p>   there')).toBe('Hello there');
    expect(formatContentValue({ nested: true })).toBe('{\n  "nested": true\n}');
  });
});
