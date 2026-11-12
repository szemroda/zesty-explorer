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

/** The relationship links between an instance's collections, indexed by collection. */
export interface RelatedCollections {
  /** Relationship fields each collection owns, in field order. */
  readonly contains: ReadonlyMap<ModelZuid, readonly RelatedLink[]>;
  /** Fields of other collections that point at each collection, by collection label. */
  readonly referencedBy: ReadonlyMap<ModelZuid, readonly RelatedLink[]>;
  readonly labels: ReadonlyMap<ModelZuid, string>;
}

/** Indexes the links of every schema once. `labels` override schema labels, e.g. catalog ones. */
export function indexRelatedCollections(
  schemas: Iterable<CollectionSchema>,
  catalogLabels: ReadonlyMap<ModelZuid, string>,
): RelatedCollections {
  const labels = new Map(catalogLabels);
  const sorted = [...schemas];
  for (const schema of sorted) {
    if (!labels.has(schema.modelZuid)) labels.set(schema.modelZuid, schema.label);
  }
  sorted.sort((left, right) =>
    labels.get(left.modelZuid)!.localeCompare(labels.get(right.modelZuid)!),
  );
  const contains = new Map<ModelZuid, RelatedLink[]>();
  const referencedBy = new Map<ModelZuid, RelatedLink[]>();
  const append = (index: Map<ModelZuid, RelatedLink[]>, key: ModelZuid, link: RelatedLink) => {
    const links = index.get(key);
    if (links) links.push(link);
    else index.set(key, [link]);
  };
  for (const schema of sorted) {
    for (const field of schema.fields) {
      const target = field.relatedModelZuid;
      if (field.kind !== 'relationship' || !target) continue;
      append(contains, schema.modelZuid, {
        modelZuid: target,
        field,
        relationship: {
          kind: 'native',
          fieldSide: 'parent',
          field: [field.name],
          relatedModelZuid: target,
        },
      });
      if (target === schema.modelZuid) continue;
      append(referencedBy, target, {
        modelZuid: schema.modelZuid,
        field,
        relationship: {
          kind: 'native',
          fieldSide: 'child',
          field: [field.name],
          relatedModelZuid: target,
        },
      });
    }
  }
  return { contains, referencedBy, labels };
}

/** The links from one collection: those it contains, then, when `referencedBy` is set, the rest. */
export function relatedLinks(
  modelZuid: ModelZuid,
  collections: RelatedCollections,
  referencedBy: boolean,
): readonly RelatedLink[] {
  const contains = collections.contains.get(modelZuid) ?? [];
  if (!referencedBy) return contains;
  return [...contains, ...(collections.referencedBy.get(modelZuid) ?? [])];
}

/**
 * Names a new node after its collection, or after its field when `shared`, i.e. when the parent
 * has or may get another node of the same collection: "Optional coverages", or "Offers (Product)"
 * for a link the child owns.
 */
function relatedLinkName(
  link: RelatedLink,
  shared: boolean,
  { labels }: RelatedCollections,
): string {
  const label = labels.get(link.modelZuid) ?? link.modelZuid;
  if (!shared) return label;
  return link.relationship.fieldSide === 'parent'
    ? link.field.label
    : `${label} (${link.field.label})`;
}

function linksTo(links: readonly RelatedLink[], link: RelatedLink, sameSide: boolean): number {
  return links.filter(
    (other) =>
      other.modelZuid === link.modelZuid &&
      (!sameSide || other.relationship.fieldSide === link.relationship.fieldSide),
  ).length;
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
    // Further links on the same side may reach the same collection again in another role. A link
    // on the other side often mirrors one already added, so the build leaves it to the "+" menu.
    const addedHere = new Map<ModelZuid, RelatedLink['relationship']['fieldSide']>();
    const children: CollectionNode[] = [];
    for (const link of links) {
      if (count >= autoTreeLimits.nodes) break;
      const side = link.relationship.fieldSide;
      if (shown.has(link.modelZuid) && addedHere.get(link.modelZuid) !== side) continue;
      // The build adds one side per collection, so only that side can share a name.
      const name = relatedLinkName(link, linksTo(links, link, true) > 1, collections);
      const child = createNode(link, name);
      if (!child) continue;
      shown.add(link.modelZuid);
      addedHere.set(link.modelZuid, side);
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
    .map((link) => {
      const shared =
        linksTo(links, link, false) > 1 ||
        node.children.some((child) => child.reference.modelZuid === link.modelZuid);
      return { link, name: relatedLinkName(link, shared, collections) };
    });
}

function nodePath(root: CollectionNode, nodeId: CollectionNodeId): readonly CollectionNode[] {
  if (root.id === nodeId) return [root];
  for (const child of root.children) {
    const below = nodePath(child, nodeId);
    if (below.length > 0) return [root, ...below];
  }
  return [];
}
