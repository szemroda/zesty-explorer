import { describe, expect, it } from 'vitest';
import type { CollectionCatalogEntry, CollectionSchema, ModelZuid } from '../../domain';
import { relatedLinks } from '../../explorer-core';
import { relatedCollectionsFor } from './useSchemaIndex';

const reference = {
  instanceZuid: '8-abc123',
  deployment: 'production',
  area: 'content',
  apiBaseUrl: 'https://8-abc123.api.zesty.io/v1',
  managerBaseUrl: 'https://8-abc123.manager.zesty.io',
} as const;
const entry = (modelZuid: ModelZuid, label: string): CollectionCatalogEntry => ({
  label,
  name: label.toLowerCase(),
  type: 'pageset',
  group: 'content',
  reference: { ...reference, modelZuid },
});
const catalog = [
  entry('6-stories1', 'Stories'),
  entry('6-tags1234', 'Tags'),
  entry('6-notes1234', 'Notes'),
];
const stories = (target: ModelZuid): CollectionSchema => ({
  modelZuid: '6-stories1',
  label: 'Stories',
  fields: [
    {
      id: '12-link1234',
      name: 'link',
      label: 'Link',
      kind: 'relationship',
      relatedModelZuid: target,
    },
  ],
});

function containedBy(index: Parameters<typeof relatedCollectionsFor>[2], view: CollectionSchema[]) {
  const { collections } = relatedCollectionsFor(
    reference,
    catalog,
    index,
    new Map(view.map((schema, position) => [`node-${position}`, schema])),
  );
  return relatedLinks('6-stories1', collections, false).map((link) => link.modelZuid);
}

describe('related collections for a view', () => {
  it('takes each schema from its freshest copy', () => {
    const none = new Map<ModelZuid, CollectionSchema>();
    const index = (schema: CollectionSchema) => new Map([[schema.modelZuid, schema]]);

    // A view refreshed after the index's copy went stale wins over it.
    expect(
      containedBy({ schemas: none, staleSchemas: index(stories('6-tags1234')) }, [
        stories('6-notes1234'),
      ]),
    ).toEqual(['6-notes1234']);
    // An index copy loaded since the last Refresh wins over the view's.
    expect(
      containedBy({ schemas: index(stories('6-tags1234')), staleSchemas: none }, [
        stories('6-notes1234'),
      ]),
    ).toEqual(['6-tags1234']);
  });
});
