import type {
  CollectionReference,
  CollectionSnapshot,
  ContentScope,
  ExplorerError,
} from '../domain';

export type SnapshotLoadState =
  | { readonly status: 'complete'; readonly snapshot: CollectionSnapshot }
  | { readonly status: 'partial'; readonly snapshot: CollectionSnapshot }
  | { readonly status: 'failed'; readonly error: ExplorerError };

export interface SnapshotLoadResult {
  readonly snapshots: ReadonlyMap<string, SnapshotLoadState>;
  readonly totalItems: number;
}

export function snapshotQueryKey(
  reference: Omit<CollectionReference, 'itemZuid'>,
  scope: ContentScope,
): string {
  return [
    reference.instanceZuid,
    reference.deployment,
    reference.modelZuid,
    scope.state,
    scope.language,
  ].join(':');
}
