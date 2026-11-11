// Builds and extends a view's collection tree from the native relationships in Zesty schemas.
//
// A relationship field links two collections, and either one can be the parent in a view:
// - "contains": the parent owns the field (Products.Coverages lists coverages);
// - "referenced by": the child owns the field (Offers.Product points at a product).
//
// Automatic building follows these rules:
// - Each relationship field of a parent becomes its own node, so Products.Included coverages and
//   Products.Optional coverages are two tables.
// - Every other collection appears once: a collection reached again through another parent stays
//   a suggestion, and its own relationships are expanded under its first node only.
// - "Contains" links come first. "Referenced by" links are followed from the root only, because
//   reverse links multiply quickly in a densely related schema.
// - It stops at `autoTreeLimits`, leaving room below `viewTreeLimits` to add more by hand.
import type { CollectionNode, CollectionNodeId, CollectionSchema, ModelZuid } from '../domain';
import { viewTreeLimits } from './collection-tree';
import type { NativeRelationshipCandidate } from './relationships';
import { sameNativeRelationship } from './relationships';

/** How far automatic building goes: at most 15 nodes and three levels below the root. */
export const autoTreeLimits = { nodes: 15, depth: 3 } as const;

/** One way to attach a collection below a parent collection. */
export interface RelatedLink extends NativeRelationshipCandidate {
  /** The collection attached as the child. */
  readonly modelZuid: ModelZuid;
}

/** A link that can be added below one node, with the name its new node gets. */
export interface RelatedSuggestion {
  readonly link: RelatedLink;
  readonly name: string;
}

/** What is known about an instance's collections: loaded schemas and catalog labels. */
export interface RelatedCollections {
  readonly schemas: ReadonlyMap<ModelZuid, CollectionSchema>;
  readonly labels: ReadonlyMap<ModelZuid, string>;
}

/**
 * The links from one collection: the relationship fields it owns, in field order, then, when
 * `referencedBy` is set, the fields of other collections that point at it, by collection label.
 */
export function relatedLinks(
  modelZuid: ModelZuid,
  { schemas, labels }: RelatedCollections,
  referencedBy: boolean,
): readonly RelatedLink[] {
  const labelOf = (schema: CollectionSchema) => labels.get(schema.modelZuid) ?? schema.label;
  const contains = (schemas.get(modelZuid)?.fields ?? []).flatMap((field): RelatedLink[] =>
    field.kind === 'relationship' && field.relatedModelZuid
      ? [
          {
            modelZuid: field.relatedModelZuid,
            field,
            relationship: {
              kind: 'native',
              fieldSide: 'parent',
              field: [field.name],
              relatedModelZuid: field.relatedModelZuid,
            },
          },
        ]
      : [],
  );
  if (!referencedBy) return contains;
  const referencing = [...schemas.values()]
    .filter((schema) => schema.modelZuid !== modelZuid)
    .toSorted((left, right) => labelOf(left).localeCompare(labelOf(right)))
    .flatMap((schema) =>
      schema.fields
        .filter((field) => field.kind === 'relationship' && field.relatedModelZuid === modelZuid)
        .map((field): RelatedLink => ({
          modelZuid: schema.modelZuid,
          field,
          relationship: {
            kind: 'native',
            fieldSide: 'child',
            field: [field.name],
            relatedModelZuid: modelZuid,
          },
        })),
    );
  return [...contains, ...referencing];
}

/**
 * Names a new node after its collection, or after its field when the parent has another link to
 * the same collection: "Optional coverages", or "Offers (Product)" for a link the child owns.
 */
export function relatedLinkName(
  link: RelatedLink,
  siblings: readonly RelatedLink[],
  { schemas, labels }: RelatedCollections,
): string {
  const label = labels.get(link.modelZuid) ?? schemas.get(link.modelZuid)?.label ?? link.modelZuid;
  const ambiguous = siblings.filter((sibling) => sibling.modelZuid === link.modelZuid).length > 1;
  if (!ambiguous) return label;
  return link.relationship.fieldSide === 'parent'
    ? link.field.label
    : `${label} (${link.field.label})`;
}

/**
 * Fills a root-only tree with related collections. `createNode` turns a link into a node, or
 * returns undefined for a collection the view cannot attach.
 */
export function buildRelatedTree(
  root: CollectionNode,
  collections: RelatedCollections,
  createNode: (link: RelatedLink, name: string) => CollectionNode | undefined,
): CollectionNode {
  const added = new Map<CollectionNodeId, CollectionNode[]>();
  const shown = new Set<ModelZuid>([root.reference.modelZuid]);
  const queue: { readonly node: CollectionNode; readonly depth: number }[] = [
    { node: root, depth: 0 },
  ];
  let count = 1;
  for (let index = 0; index < queue.length; index += 1) {
    const { node, depth } = queue[index]!;
    if (depth >= autoTreeLimits.depth) continue;
    const links = relatedLinks(node.reference.modelZuid, collections, depth === 0);
    // Further fields of this parent may link the same collection again in another role.
    const addedHere = new Set<ModelZuid>();
    const children: CollectionNode[] = [];
    for (const link of links) {
      if (count >= autoTreeLimits.nodes) break;
      if (shown.has(link.modelZuid) && !addedHere.has(link.modelZuid)) continue;
      const child = createNode(link, relatedLinkName(link, links, collections));
      if (!child) continue;
      shown.add(link.modelZuid);
      addedHere.add(link.modelZuid);
      children.push(child);
      queue.push({ node: child, depth: depth + 1 });
      count += 1;
    }
    added.set(node.id, children);
  }
  const assemble = (node: CollectionNode): CollectionNode => ({
    ...node,
    children: [...node.children, ...(added.get(node.id) ?? [])].map(assemble),
  });
  return assemble(root);
}

/**
 * The links one node can still add: not already used by its children and not leading back to a
 * collection on its own path. Empty for a node at the deepest level a view allows.
 */
export function relatedSuggestions(
  root: CollectionNode,
  nodeId: CollectionNodeId,
  collections: RelatedCollections,
  referencedBy: boolean,
): readonly RelatedSuggestion[] {
  const path = nodePath(root, nodeId);
  const node = path.at(-1);
  if (!node || path.length >= viewTreeLimits.levels) return [];
  const onPath = new Set(path.map((entry) => entry.reference.modelZuid));
  const links = relatedLinks(node.reference.modelZuid, collections, referencedBy);
  return links
    .filter(
      (link) =>
        !onPath.has(link.modelZuid) &&
        !node.children.some(
          (child) =>
            child.reference.modelZuid === link.modelZuid &&
            child.relationship?.kind === 'native' &&
            sameNativeRelationship(child.relationship, link.relationship),
        ),
    )
    .map((link) => ({ link, name: relatedLinkName(link, links, collections) }));
}

function nodePath(root: CollectionNode, nodeId: CollectionNodeId): readonly CollectionNode[] {
  if (root.id === nodeId) return [root];
  for (const child of root.children) {
    const below = nodePath(child, nodeId);
    if (below.length > 0) return [root, ...below];
  }
  return [];
}
