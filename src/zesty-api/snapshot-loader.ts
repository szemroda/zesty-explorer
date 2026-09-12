import { Effect, Either } from 'effect';
import type {
  CollectionNode,
  CollectionReference,
  CollectionSnapshot,
  ContentState,
  ExplorerError,
} from '../domain';
import type { ZestyApi } from './types';

export type SnapshotLoadState =
  | { readonly status: 'pending' }
  | { readonly status: 'stale'; readonly snapshot: CollectionSnapshot }
  | { readonly status: 'complete'; readonly snapshot: CollectionSnapshot }
  | { readonly status: 'partial'; readonly snapshot: CollectionSnapshot }
  | { readonly status: 'failed'; readonly error: ExplorerError };

export interface SnapshotLoadResult {
  readonly snapshots: ReadonlyMap<string, SnapshotLoadState>;
  readonly totalItems: number;
}

export interface SnapshotLoader {
  load(
    root: CollectionNode,
    state: ContentState,
    sessionToken: string,
  ): Effect.Effect<SnapshotLoadResult, ExplorerError>;
}

interface SnapshotLoaderOptions {
  readonly viewLimit?: number;
}

export function snapshotQueryKey(
  reference: Omit<CollectionReference, 'itemZuid'>,
  state: ContentState,
): string {
  return [reference.instanceZuid, reference.deployment, reference.modelZuid, state, 'en-US'].join(
    ':',
  );
}

function flattenDescendants(root: CollectionNode): readonly CollectionNode[] {
  const descendants: CollectionNode[] = [];
  const visit = (node: CollectionNode) => {
    for (const child of node.children) {
      descendants.push(child);
      visit(child);
    }
  };
  visit(root);
  return descendants;
}

function uniqueNodes(
  nodes: readonly CollectionNode[],
  state: ContentState,
): readonly CollectionNode[] {
  const unique = new Map<string, CollectionNode>();
  for (const node of nodes) {
    const key = snapshotQueryKey(node.reference, state);
    if (!unique.has(key)) unique.set(key, node);
  }
  return [...unique.values()];
}

function limitSnapshot(
  snapshot: CollectionSnapshot,
  remaining: number,
): { readonly snapshot: CollectionSnapshot; readonly count: number } {
  const items = snapshot.items.slice(0, Math.max(0, remaining));
  if (items.length === snapshot.items.length) return { snapshot, count: items.length };
  return {
    snapshot: {
      ...snapshot,
      items,
      itemsById: new Map(items.map((item) => [item.id, item])),
      partial: true,
    },
    count: items.length,
  };
}

function loadedState(snapshot: CollectionSnapshot): SnapshotLoadState {
  return snapshot.partial ? { status: 'partial', snapshot } : { status: 'complete', snapshot };
}

export function createSnapshotPlan(
  root: CollectionNode,
  state: ContentState,
  previous: ReadonlyMap<string, CollectionSnapshot> = new Map(),
): ReadonlyMap<string, SnapshotLoadState> {
  const plan = new Map<string, SnapshotLoadState>();
  for (const node of uniqueNodes([root, ...flattenDescendants(root)], state)) {
    const key = snapshotQueryKey(node.reference, state);
    const snapshot = previous.get(key);
    plan.set(key, snapshot ? { status: 'stale', snapshot } : { status: 'pending' });
  }
  return plan;
}

export function createSnapshotLoader(
  api: ZestyApi,
  options: SnapshotLoaderOptions = {},
): SnapshotLoader {
  const viewLimit = options.viewLimit ?? 50_000;

  return {
    load: (root, state, sessionToken) =>
      Effect.gen(function* () {
        const snapshots = new Map<string, SnapshotLoadState>();
        const rootSnapshot = yield* api.loadCollectionSnapshot(
          root.reference,
          state,
          sessionToken,
          viewLimit,
        );
        const limitedRoot = limitSnapshot(rootSnapshot, viewLimit);
        snapshots.set(snapshotQueryKey(root.reference, state), loadedState(limitedRoot.snapshot));
        let totalItems = limitedRoot.count;

        const descendants = uniqueNodes(flattenDescendants(root), state);
        if (totalItems >= viewLimit) {
          const error: ExplorerError = {
            kind: 'data-limit',
            scope: 'view',
            message: 'The view reached its 50,000 content-item limit.',
          };
          descendants.forEach((node) =>
            snapshots.set(snapshotQueryKey(node.reference, state), { status: 'failed', error }),
          );
          return { snapshots, totalItems };
        }

        for (const node of descendants) {
          const key = snapshotQueryKey(node.reference, state);
          if (totalItems >= viewLimit) {
            snapshots.set(key, {
              status: 'failed',
              error: {
                kind: 'data-limit',
                scope: 'view',
                message: 'The view reached its 50,000 content-item limit.',
              },
            });
            continue;
          }
          const result = yield* api
            .loadCollectionSnapshot(node.reference, state, sessionToken, viewLimit - totalItems)
            .pipe(Effect.either);
          if (Either.isLeft(result)) {
            snapshots.set(key, { status: 'failed', error: result.left });
            continue;
          }
          const limited = limitSnapshot(result.right, viewLimit - totalItems);
          totalItems += limited.count;
          snapshots.set(key, loadedState(limited.snapshot));
        }

        return { snapshots, totalItems };
      }),
  };
}
