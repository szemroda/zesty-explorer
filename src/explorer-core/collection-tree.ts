import type {
  CollectionNode,
  CollectionNodeId,
  NodePresentation,
  RelationshipDefinition,
} from '../domain';

/** How large a view's collection tree may grow. The root counts as one node and one level. */
export const viewTreeLimits = { nodes: 20, levels: 5 } as const;

export type TreeOperationResult =
  | { readonly ok: true; readonly root: CollectionNode }
  | { readonly ok: false; readonly reason: string };

export type TreeValidationResult =
  | { readonly ok: true; readonly nodeCount: number; readonly depth: number }
  | { readonly ok: false; readonly reason: string };

export function validateCollectionTree(root: CollectionNode): TreeValidationResult {
  const ids = new Set<CollectionNodeId>();
  const objects = new WeakSet<object>();
  let nodeCount = 0;
  let maximumDepth = 0;
  let problem: string | undefined;

  const visit = (node: CollectionNode, depth: number) => {
    if (problem) return;
    if (objects.has(node) || ids.has(node.id)) {
      problem = 'Collection nodes must form an acyclic tree with unique node IDs.';
      return;
    }
    objects.add(node);
    ids.add(node.id);
    nodeCount += 1;
    maximumDepth = Math.max(maximumDepth, depth);
    if (nodeCount > viewTreeLimits.nodes) {
      problem = `A view may contain at most ${viewTreeLimits.nodes} nodes.`;
      return;
    }
    if (depth > viewTreeLimits.levels) {
      problem = `A view may contain at most ${viewTreeLimits.levels} levels.`;
      return;
    }
    if (
      node.reference.instanceZuid !== root.reference.instanceZuid ||
      node.reference.deployment !== root.reference.deployment
    ) {
      problem = 'Every collection node must belong to the root instance and deployment.';
      return;
    }
    node.children.forEach((child) => visit(child, depth + 1));
  };

  visit(root, 1);
  return problem ? { ok: false, reason: problem } : { ok: true, nodeCount, depth: maximumDepth };
}

function insertAt(
  node: CollectionNode,
  parentId: CollectionNodeId,
  child: CollectionNode,
): { readonly root: CollectionNode; readonly found: boolean } {
  if (node.id === parentId)
    return { root: { ...node, children: [...node.children, child] }, found: true };
  let found = false;
  const children = node.children.map((current) => {
    if (found) return current;
    const result = insertAt(current, parentId, child);
    found = result.found;
    return result.root;
  });
  return { root: found ? { ...node, children } : node, found };
}

export function addCollectionNode(
  root: CollectionNode,
  parentId: CollectionNodeId,
  child: CollectionNode,
): TreeOperationResult {
  if (
    child.reference.instanceZuid !== root.reference.instanceZuid ||
    child.reference.deployment !== root.reference.deployment
  ) {
    return {
      ok: false,
      reason: 'Every collection node must belong to the root instance and deployment.',
    };
  }
  const inserted = insertAt(root, parentId, child);
  if (!inserted.found) return { ok: false, reason: 'The parent collection node no longer exists.' };
  const validation = validateCollectionTree(inserted.root);
  return validation.ok ? { ok: true, root: inserted.root } : validation;
}

export function renameCollectionNode(
  root: CollectionNode,
  nodeId: CollectionNodeId,
  name: string,
): CollectionNode {
  const trimmed = name.trim();
  if (!trimmed) return root;
  if (root.id === nodeId) return { ...root, name: trimmed };
  return {
    ...root,
    children: root.children.map((child) => renameCollectionNode(child, nodeId, trimmed)),
  };
}

export function updateNodePresentation(
  root: CollectionNode,
  nodeId: CollectionNodeId,
  presentation: NodePresentation,
): CollectionNode {
  if (root.id === nodeId) return { ...root, presentation };
  return {
    ...root,
    children: root.children.map((child) => updateNodePresentation(child, nodeId, presentation)),
  };
}

export function updateCollectionRelationship(
  root: CollectionNode,
  nodeId: CollectionNodeId,
  relationship: RelationshipDefinition,
): CollectionNode {
  if (root.id === nodeId) return root;
  return {
    ...root,
    children: root.children.map((child) =>
      child.id === nodeId
        ? { ...child, relationship }
        : updateCollectionRelationship(child, nodeId, relationship),
    ),
  };
}

/** `target` with the presentation that each node it shares with `source` has there. */
export function withPresentationsOf(
  target: CollectionNode,
  source: CollectionNode,
): CollectionNode {
  const presentations = new Map<CollectionNodeId, NodePresentation>();
  const collect = (node: CollectionNode) => {
    presentations.set(node.id, node.presentation);
    node.children.forEach(collect);
  };
  collect(source);
  const apply = (node: CollectionNode): CollectionNode => ({
    ...node,
    presentation: presentations.get(node.id) ?? node.presentation,
    children: node.children.map(apply),
  });
  return apply(target);
}

export function removeCollectionNode(
  root: CollectionNode,
  nodeId: CollectionNodeId,
): CollectionNode | undefined {
  if (root.id === nodeId) return undefined;
  return {
    ...root,
    children: root.children
      .filter((child) => child.id !== nodeId)
      .map((child) => removeCollectionNode(child, nodeId) ?? child),
  };
}

export function subtreeNodeNames(
  root: CollectionNode,
  nodeId: CollectionNodeId,
): readonly string[] {
  if (root.id === nodeId) {
    const names: string[] = [];
    const visit = (node: CollectionNode) => {
      names.push(node.name);
      node.children.forEach(visit);
    };
    visit(root);
    return names;
  }
  for (const child of root.children) {
    const found = subtreeNodeNames(child, nodeId);
    if (found.length > 0) return found;
  }
  return [];
}
