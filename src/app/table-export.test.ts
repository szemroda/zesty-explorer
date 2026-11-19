import { describe, expect, it } from 'vitest';
import type {
  CollectionNode,
  CollectionSchema,
  CollectionSnapshot,
  ContentItem,
  ItemZuid,
  ModelZuid,
} from '../domain';
import { nodePath } from '../explorer-core';
import { collectionNode, latestScope } from '../test/fixtures';
import { snapshotQueryKey } from '../zesty-api';
import { contentItemColumns } from './content-item-presentation';
import { buildLoadedViewGraph, type LoadedView } from './load-view';
import {
  exportableColumns,
  exportTable,
  rowsUnderEveryParent,
  type ExportView,
} from './table-export';

const item = (id: ItemZuid, fields: Record<string, unknown>): ContentItem => ({
  id,
  fields,
  metadata: { created: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:00:00Z', version: 1 },
  raw: {},
});

function snapshot(modelZuid: ModelZuid, items: readonly ContentItem[]): CollectionSnapshot {
  return {
    id: `snapshot-${modelZuid}`,
    instanceZuid: '8-fixture-instance',
    modelZuid,
    state: 'latest',
    language: 'en-US',
    items,
    itemsById: new Map(items.map((entry) => [entry.id, entry])),
    partial: false,
  };
}

const articleSchema: CollectionSchema = {
  modelZuid: '6-articles',
  label: 'Articles',
  fields: [
    { id: '12-title', name: 'title', label: 'Title', kind: 'text' },
    { id: '12-key', name: 'key', label: 'Key', kind: 'text' },
    { id: '12-body', name: 'body', label: 'Body', kind: 'text', datatype: 'wysiwyg_basic' },
    { id: '12-featured', name: 'featured', label: 'Featured', kind: 'boolean' },
    { id: '12-words', name: 'words', label: 'Words', kind: 'number' },
  ],
};
const commentSchema: CollectionSchema = {
  modelZuid: '6-comments',
  label: 'Comments',
  fields: [
    { id: '12-name', name: 'name', label: 'Name', kind: 'text' },
    { id: '12-approved', name: 'approved', label: 'Approved', kind: 'text' },
  ],
};
const replySchema: CollectionSchema = {
  modelZuid: '6-replies',
  label: 'Replies',
  fields: [{ id: '12-reply', name: 'reply', label: 'Reply', kind: 'text' }],
};

const articles = [
  item('7-a1', {
    title: 'First',
    key: 'a1',
    body: '<p>Hello <b>world</b>.</p><ul><li>One</li><li>Two</li></ul>',
    featured: 1,
    words: 120,
  }),
  item('7-a2', { title: 'Second', key: 'a2', body: '<p>&nbsp;</p>', featured: 0, words: 80 }),
];
const comments = [
  item('7-c1', { name: 'Ann', article: 'a1', key: 'c1', approved: 'yes' }),
  item('7-c2', { name: 'Bot', article: 'a1', key: 'c2', approved: 'no' }),
  item('7-c3', { name: 'Cid', article: 'a2', key: 'c3', approved: 'yes' }),
];
const replies = [
  item('7-r1', { reply: 'Agreed', comment: 'c1' }),
  item('7-r2', { reply: 'Welcome', comment: 'c3' }),
  item('7-r3', { reply: 'Hidden', comment: 'c2' }),
];

const replyNode: CollectionNode = {
  ...collectionNode('node-replies', '6-replies'),
  name: 'Replies',
  relationship: { kind: 'custom', parentField: ['key'], childField: ['comment'] },
};
const base = collectionNode('node-comments', '6-comments', [replyNode]);
// Comments show only approved ones, so the spam comment and its reply stay out of every file.
const commentNode: CollectionNode = {
  ...base,
  name: 'Comments',
  relationship: { kind: 'custom', parentField: ['key'], childField: ['article'] },
  presentation: {
    ...base.presentation,
    filters: [
      { id: 'approved', nodePath: [], fieldPath: ['approved'], operator: 'equals', value: 'yes' },
    ],
  },
};
const root: CollectionNode = {
  ...collectionNode('node-articles', '6-articles', [commentNode]),
  name: 'Articles',
};

const loadedView: LoadedView = {
  snapshots: {
    snapshots: new Map([
      [
        snapshotQueryKey(root.reference, latestScope),
        { status: 'complete', snapshot: snapshot('6-articles', articles) },
      ],
      [
        snapshotQueryKey(commentNode.reference, latestScope),
        { status: 'complete', snapshot: snapshot('6-comments', comments) },
      ],
      [
        snapshotQueryKey(replyNode.reference, latestScope),
        { status: 'complete', snapshot: snapshot('6-replies', replies) },
      ],
    ]),
    totalItems: 8,
  },
  schemas: new Map([
    [root.id, articleSchema],
    [commentNode.id, commentSchema],
    [replyNode.id, replySchema],
  ]),
  schemaErrors: new Map(),
};
const view: ExportView = {
  graph: buildLoadedViewGraph(root, loadedView, latestScope),
  loadedView,
  scope: latestScope,
};

const columnsOf = (schema: CollectionSchema, items: readonly ContentItem[], ids: string[]) =>
  exportableColumns(contentItemColumns(schema, items)).filter((column) => ids.includes(column.id));

describe('table export', () => {
  it('writes cells as the table shows them and sums up related items after them', () => {
    const table = exportTable(view, {
      rows: articles.map((article) => ({ item: article })),
      columns: columnsOf(articleSchema, articles, ['$id', 'title', 'body', 'featured', 'words']),
      related: [
        { node: commentNode, summary: 'names' },
        { node: commentNode, summary: 'count' },
      ],
    });

    expect(table).toEqual({
      headers: ['ZUID', 'Title', 'Body', 'Featured', 'Words', 'Comments', 'Comments count'],
      rows: [
        ['7-a1', 'First', 'Hello world.\nOne\nTwo', 'Yes', 120, 'Ann', 1],
        ['7-a2', 'Second', null, 'No', 80, 'Cid', 1],
      ],
    });
  });

  it('lists a nested collection below every root item, with each row naming its parent', () => {
    const path = nodePath(root, replyNode.id);
    const table = exportTable(view, {
      rows: rowsUnderEveryParent(view, path, articles),
      columns: columnsOf(replySchema, replies, ['reply']),
      parentNode: commentNode,
    });

    expect(table).toEqual({
      headers: ['Comments ZUID', 'Comments', 'Reply'],
      rows: [
        ['7-c1', 'Ann', 'Agreed'],
        ['7-c3', 'Cid', 'Welcome'],
      ],
    });
  });

  it('leaves raw JSON and publication status out of the exportable columns', () => {
    const ids = exportableColumns(contentItemColumns(replySchema, replies)).map(
      (column) => column.id,
    );

    expect(ids).toEqual(['$id', 'reply', '$created', '$modified', '$version']);
  });
});
