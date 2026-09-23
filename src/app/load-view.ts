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
import { snapshotQueryKey, type CollectionApi, type SnapshotLoadResult } from '../zesty-api';

export interface LoadedCollection {
  readonly schema: CollectionSchema;
  readonly snapshot: CollectionSnapshot;
}

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

export async function loadCollection(
  api: CollectionApi,
  node: CollectionNode,
  state: ContentState,
  sessionToken: string,
  itemLimit: number,
  signal?: AbortSignal,
): Promise<LoadedCollection> {
  const program = Effect.all(
    [
      api.loadCollectionSchema(node.reference, sessionToken),
      api.loadCollectionSnapshot(node.reference, state, sessionToken, itemLimit),
    ] as const,
    { concurrency: 2 },
  ).pipe(Effect.either);
  const result = signal
    ? await Effect.runPromise(program, { signal })
    : await Effect.runPromise(program);
  if (Either.isLeft(result)) throw new ViewLoadError(result.left);
  return { schema: result.right[0], snapshot: result.right[1] };
}

export function rootLoadedView(
  root: CollectionNode,
  state: ContentState,
  loaded: LoadedCollection,
): LoadedView {
  return {
    snapshots: {
      snapshots: new Map([
        [
          snapshotQueryKey(root.reference, state),
          loaded.snapshot.partial
            ? { status: 'partial', snapshot: loaded.snapshot }
            : { status: 'complete', snapshot: loaded.snapshot },
        ],
      ]),
      totalItems: loaded.snapshot.items.length,
    },
    schemas: new Map([[root.id, loaded.schema]]),
    schemaErrors: new Map(),
  };
}

function emptyPartialSnapshot(node: CollectionNode, state: ContentState): CollectionSnapshot {
  return {
    id: `snapshot-${node.reference.instanceZuid}-${node.reference.modelZuid}-${state}-en-US`,
    instanceZuid: node.reference.instanceZuid,
    modelZuid: node.reference.modelZuid,
    state,
    language: 'en-US',
    items: [],
    itemsById: new Map(),
    partial: true,
  };
}

type CachedCollectionLoader = (
  node: CollectionNode,
  itemLimit: number,
) => Promise<LoadedCollection>;

const graphCache = new WeakMap<LoadedView, Map<string, ExplorerGraph>>();

function relationshipGraphKey(root: CollectionNode, state: ContentState): string {
  const describe = (node: CollectionNode): unknown => ({
    id: node.id,
    reference: snapshotQueryKey(node.reference, state),
    relationship: node.relationship,
    children: node.children.map(describe),
  });
  return JSON.stringify(describe(root));
}

export async function loadView(
  root: CollectionNode,
  state: ContentState,
  loadedRoot: LoadedCollection,
  loadCachedCollection: CachedCollectionLoader,
): Promise<LoadedView> {
  const nodes = flattenCollectionNodes(root);
  const snapshots = new Map(rootLoadedView(root, state, loadedRoot).snapshots.snapshots);
  const schemas = new Map<CollectionNodeId, CollectionSchema>([[root.id, loadedRoot.schema]]);
  const schemaErrors = new Map<CollectionNodeId, ExplorerError>();
  const uniqueDescendants = new Map<string, CollectionNode>();
  for (const node of nodes.slice(1)) {
    const key = snapshotQueryKey(node.reference, state);
    if (!uniqueDescendants.has(key)) uniqueDescendants.set(key, node);
  }

  let totalItems = loadedRoot.snapshot.items.length;
  for (const node of uniqueDescendants.values()) {
    const key = snapshotQueryKey(node.reference, state);
    if (totalItems >= 50_000) {
      const error: ExplorerError = {
        kind: 'data-limit',
        scope: 'view',
        message: 'The view reached its 50,000 content-item limit.',
      };
      snapshots.set(key, { status: 'partial', snapshot: emptyPartialSnapshot(node, state) });
      for (const matchingNode of nodes.filter(
        (candidate) => snapshotQueryKey(candidate.reference, state) === key,
      )) {
        schemaErrors.set(matchingNode.id, error);
      }
      continue;
    }

    try {
      const loaded = await loadCachedCollection(node, Math.min(10_000, 50_000 - totalItems));
      totalItems += loaded.snapshot.items.length;
      snapshots.set(
        key,
        loaded.snapshot.partial
          ? { status: 'partial', snapshot: loaded.snapshot }
          : { status: 'complete', snapshot: loaded.snapshot },
      );
      for (const matchingNode of nodes.filter(
        (candidate) => snapshotQueryKey(candidate.reference, state) === key,
      )) {
        schemas.set(matchingNode.id, loaded.schema);
      }
    } catch (error) {
      const failure: ExplorerError =
        error instanceof ViewLoadError
          ? error.failure
          : { kind: 'network', message: 'The collection could not be loaded.' };
      snapshots.set(key, { status: 'failed', error: failure });
      for (const matchingNode of nodes.filter(
        (candidate) => snapshotQueryKey(candidate.reference, state) === key,
      )) {
        schemaErrors.set(matchingNode.id, failure);
      }
    }
  }

  return { snapshots: { snapshots, totalItems }, schemas, schemaErrors };
}

export function buildLoadedViewGraph(
  root: CollectionNode,
  loaded: LoadedView,
  state: ContentState,
): ExplorerGraph {
  const key = relationshipGraphKey(root, state);
  const cached = graphCache.get(loaded)?.get(key);
  if (cached) return cached;

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
        const index = buildRelationshipIndex(childSnapshot, child.relationship);
        relationshipsByChildNode.set(
          child.id,
          joinRelatedItems(parentSnapshot, index, child.relationship),
        );
      }
      visit(child);
    }
  };
  visit(root);

  const graph = createExplorerGraph({
    rootNodeId: root.id,
    snapshots,
    childrenByNode,
    relationshipsByChildNode,
  });
  const entries = graphCache.get(loaded) ?? new Map<string, ExplorerGraph>();
  entries.set(key, graph);
  graphCache.set(loaded, entries);
  return graph;
}
