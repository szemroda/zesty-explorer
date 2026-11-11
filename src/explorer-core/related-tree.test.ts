import { describe, expect, it } from 'vitest';
import type { CollectionField, CollectionNode, CollectionSchema, ModelZuid } from '../domain';
import { collectionNode } from '../test/fixtures';
import { buildRelatedTree, indexRelatedCollections, relatedSuggestions } from './index';

const model = (name: string): ModelZuid => `6-${name}`;
const link = (name: string, label: string, target: string): CollectionField => ({
  id: `12-${name}-${target}`,
  name,
  label,
  kind: 'relationship',
  relatedModelZuid: model(target),
});
const collection = (
  name: string,
  label: string,
  fields: readonly CollectionField[] = [],
): CollectionSchema => ({
  modelZuid: model(name),
  label,
  fields: [{ id: `12-title-${name}`, name: 'title', label: 'Title', kind: 'text' }, ...fields],
});

// Products and Coverages link both ways, and Products also links to itself.
const schemas = new Map(
  [
    collection('products', 'Products', [
      link('coverages', 'Included coverages', 'coverages'),
      link('optional_coverages', 'Optional coverages', 'coverages'),
      link('insurer', 'Insurer', 'insurers'),
      link('category', 'Category', 'categories'),
      link('documents', 'Documents', 'documents'),
      link('related_products', 'Related products', 'products'),
    ]),
    collection('coverages', 'Coverages', [
      link('limits', 'Limits', 'limits'),
      link('exclusions', 'Exclusions', 'exclusions'),
      link('coverage_type', 'Coverage type', 'coverage_types'),
    ]),
    collection('limits', 'Limits', [link('currency', 'Currency', 'currencies')]),
    collection('exclusions', 'Exclusions'),
    collection('coverage_types', 'Coverage types'),
    collection('insurers', 'Insurers', [link('country', 'Country', 'countries')]),
    collection('countries', 'Countries'),
    collection('categories', 'Categories', [link('parent', 'Parent category', 'categories')]),
    collection('documents', 'Documents', [
      link('document_type', 'Document type', 'document_types'),
    ]),
    collection('document_types', 'Document types'),
    collection('currencies', 'Currencies'),
    collection('offers', 'Offers', [
      link('product', 'Product', 'products'),
      link('coverages', 'Included coverages', 'coverages'),
      link('segment', 'Customer segment', 'segments'),
    ]),
    collection('segments', 'Customer segments'),
    collection('faq', 'FAQ', [
      link('products', 'Products', 'products'),
      link('category', 'Category', 'categories'),
    ]),
    collection('promotions', 'Promotions', [link('products', 'Products', 'products')]),
    collection('claim_guides', 'Claim guides', [link('coverage', 'Coverage', 'coverages')]),
  ].map((schema) => [schema.modelZuid, schema]),
);
const collections = indexRelatedCollections(schemas.values(), new Map());

function build(rootModel: string): CollectionNode {
  let next = 0;
  return buildRelatedTree(
    collectionNode('node-root', model(rootModel)),
    collections,
    (related, name) => {
      next += 1;
      return {
        ...collectionNode(`node-${next}`, related.modelZuid),
        name,
        relationship: related.relationship,
      };
    },
  );
}

function outline(node: CollectionNode, depth = 0): string[] {
  return [
    `${'  '.repeat(depth)}${node.name}`,
    ...node.children.flatMap((child) => outline(child, depth + 1)),
  ];
}

describe('related tree', () => {
  it('builds a tree from a root that contains its relationships', () => {
    expect(outline(build('products'))).toEqual([
      'node-root',
      '  Included coverages',
      '    Limits',
      '    Exclusions',
      '    Coverage types',
      '  Optional coverages',
      '  Insurers',
      '    Countries',
      '  Categories',
      '  Documents',
      '    Document types',
      '  FAQ',
      '  Offers',
      '    Customer segments',
      '  Promotions',
    ]);
  });

  it('nests the collections that reference the root', () => {
    const tree = build('coverages');
    expect(outline(tree)).toEqual([
      'node-root',
      '  Limits',
      '    Currencies',
      '  Exclusions',
      '  Coverage types',
      '  Claim guides',
      '  Offers',
      '    Customer segments',
      '  Products (Included coverages)',
      '    Insurers',
      '      Countries',
      '    Categories',
      '    Documents',
      '      Document types',
      '  Products (Optional coverages)',
    ]);
    expect(tree.children.at(-1)?.relationship).toEqual({
      kind: 'native',
      fieldSide: 'child',
      field: ['optional_coverages'],
      relatedModelZuid: model('coverages'),
    });
  });

  it('suggests unused links that do not lead back up the path', () => {
    const tree = build('products');
    const optional = tree.children.find((child) => child.name === 'Optional coverages')!;

    expect(
      relatedSuggestions(tree, optional.id, collections, true).map(({ name }) => name),
    ).toEqual(['Limits', 'Exclusions', 'Coverage types', 'Claim guides', 'Offers']);
    expect(relatedSuggestions(tree, tree.id, collections, true)).toEqual([]);
  });
});
