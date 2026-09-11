import { Effect, Either } from 'effect';
import type {
  CollectionNode,
  CollectionNodeId,
  CollectionSchema,
  CollectionSnapshot,
  ContentItem,
  ContentState,
  ExplorerError,
} from '../domain';
import {
  buildRelationshipIndex,
  createExplorerGraph,
  joinRelatedItems,
  type ExplorerGraph,
} from '../explorer-core';
import {
  createSnapshotLoader,
  snapshotQueryKey,
  type SnapshotLoadResult,
  type ZestyApi,
} from '../zesty-api';

export interface LoadedView {
  readonly snapshots: SnapshotLoadResult;
  readonly schemas: ReadonlyMap<CollectionNodeId, CollectionSchema>;
  readonly schemaErrors: ReadonlyMap<CollectionNodeId, ExplorerError>;
}

export class ViewLoadError extends Error {
  constructor(readonly failure: ExplorerError) {
    super(failure.message);
    this.name = 'ViewLoadError';
  }
}

export function flattenCollectionNodes(root: CollectionNode): readonly CollectionNode[] {
  const nodes: CollectionNode[] = [];
  const visit = (node: CollectionNode) => {
    nodes.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return nodes;
}

export function viewLoadKey(root: CollectionNode, state: ContentState): readonly string[] {
  return flattenCollectionNodes(root).map(
    (node) => `${node.id}:${snapshotQueryKey(node.reference, state)}`,
  );
}

export async function loadView(
  api: ZestyApi,
  root: CollectionNode,
  state: ContentState,
  sessionToken: string,
): Promise<LoadedView> {
  const rootSchemaResult = await Effect.runPromise(
    Effect.either(api.loadCollectionSchema(root.reference, sessionToken)),
  );
  if (Either.isLeft(rootSchemaResult)) throw new ViewLoadError(rootSchemaResult.left);

  const nodes = flattenCollectionNodes(root);
  const uniqueDescendants = new Map<string, CollectionNode>();
  for (const node of nodes.slice(1)) {
    const key = snapshotQueryKey(node.reference, state);
    if (!uniqueDescendants.has(key)) uniqueDescendants.set(key, node);
  }

  const [snapshotResult, schemaResults] = await Promise.all([
    Effect.runPromise(Effect.either(createSnapshotLoader(api).load(root, state, sessionToken))),
    Effect.runPromise(
      Effect.all(
        [...uniqueDescendants.values()].map((node) =>
          api.loadCollectionSchema(node.reference, sessionToken).pipe(
            Effect.either,
            Effect.map((result) => ({ node, result })),
          ),
        ),
        { concurrency: 3 },
      ),
    ),
  ]);
  if (Either.isLeft(snapshotResult)) throw new ViewLoadError(snapshotResult.left);

  const schemas = new Map<CollectionNodeId, CollectionSchema>([[root.id, rootSchemaResult.right]]);
  const schemaErrors = new Map<CollectionNodeId, ExplorerError>();
  for (const { node, result } of schemaResults) {
    for (const matchingNode of nodes.filter(
      (candidate) =>
        snapshotQueryKey(candidate.reference, state) === snapshotQueryKey(node.reference, state),
    )) {
      if (Either.isLeft(result)) schemaErrors.set(matchingNode.id, result.left);
      else schemas.set(matchingNode.id, result.right);
    }
  }
  return { snapshots: snapshotResult.right, schemas, schemaErrors };
}

export function buildLoadedViewGraph(
  root: CollectionNode,
  loaded: LoadedView,
  state: ContentState,
): ExplorerGraph {
  const nodes = flattenCollectionNodes(root);
  const snapshots = new Map<CollectionNodeId, CollectionSnapshot>();
  const childrenByNode = new Map<CollectionNodeId, readonly CollectionNodeId[]>();
  const relationshipsByChildNode = new Map<
    CollectionNodeId,
    ReadonlyMap<ContentItem['id'], readonly ContentItem['id'][]>
  >();

  for (const node of nodes) {
    childrenByNode.set(
      node.id,
      node.children.map((child) => child.id),
    );
    const snapshotState = loaded.snapshots.snapshots.get(snapshotQueryKey(node.reference, state));
    if (snapshotState?.status === 'complete' || snapshotState?.status === 'partial') {
      snapshots.set(node.id, snapshotState.snapshot);
    }
  }

  const visit = (parent: CollectionNode) => {
    const parentSnapshot = snapshots.get(parent.id);
    for (const child of parent.children) {
      const childSnapshot = snapshots.get(child.id);
      if (parentSnapshot && childSnapshot && child.relationship) {
        const childPath =
          child.relationship.kind === 'custom' ? child.relationship.childField : ['id'];
        const index = buildRelationshipIndex(childSnapshot, childPath);
        relationshipsByChildNode.set(
          child.id,
          joinRelatedItems(parentSnapshot, index, child.relationship),
        );
      }
      visit(child);
    }
  };
  visit(root);

  return createExplorerGraph({
    rootNodeId: root.id,
    snapshots,
    childrenByNode,
    relationshipsByChildNode,
  });
}
