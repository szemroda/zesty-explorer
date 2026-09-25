import type {
  CollectionNode,
  CollectionReference,
  NodePresentation,
  RelationshipDefinition,
} from '../domain';

function defaultPresentation(): NodePresentation {
  return {
    visibleColumns: ['*'],
    columnWidths: {},
    sort: { fieldPath: ['modified'], direction: 'desc' },
    filters: [],
    freeText: '',
  };
}

/** The root node of a new view. */
export function createRootNode(reference: CollectionReference, name: string): CollectionNode {
  return {
    id: 'node-root',
    name,
    reference,
    presentation: defaultPresentation(),
    children: [],
  };
}

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
    presentation: defaultPresentation(),
    children: [],
  };
}
