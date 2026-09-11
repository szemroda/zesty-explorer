import type { CollectionNode, CollectionReference, RelationshipDefinition } from '../domain';

export function createChildNode(
  reference: CollectionReference,
  name: string,
  relationship: RelationshipDefinition,
): CollectionNode {
  return {
    id: `node-${crypto.randomUUID()}`,
    name,
    reference,
    relationship,
    presentation: {
      visibleColumns: [],
      columnWidths: {},
      sort: { fieldPath: ['modified'], direction: 'desc' },
      filters: [],
      freeText: '',
    },
    children: [],
  };
}
