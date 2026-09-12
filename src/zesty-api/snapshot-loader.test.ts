import { Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';
import { generateRelationshipGraph, type CollectionNode, type CollectionSnapshot } from '../domain';
import { createSnapshotLoader, snapshotQueryKey, type ZestyApi } from './index';

const graph = generateRelationshipGraph(5);

function node(
  id: `node-${string}`,
  modelZuid: `6-${string}`,
  children: readonly CollectionNode[] = [],
): CollectionNode {
  return {
    id,
    name: id,
    reference: {
      instanceZuid: '8-fixture-instance',
      modelZuid,
      deployment: 'production',
      area: 'content',
      apiBaseUrl: 'https://8-fixture-instance.api.zesty.io/v1',
      managerBaseUrl: 'https://8-fixture-instance.manager.zesty.io',
    },
    presentation: {
      visibleColumns: ['*'],
      columnWidths: {},
      sort: { fieldPath: ['modified'], direction: 'desc' },
      filters: [],
      freeText: '',
    },
    children,
  };
}

function snapshot(modelZuid: `6-${string}`, size = 5): CollectionSnapshot {
  const items = graph.parents.items.slice(0, size);
  return {
    ...graph.parents,
    id: `snapshot-${modelZuid}`,
    modelZuid,
    items,
    itemsById: new Map(items.map((item) => [item.id, item])),
  };
}

describe('snapshot loading coordinator', () => {
  it('loads the root first, caps descendant concurrency at three, and deduplicates collections', async () => {
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    const api: ZestyApi = {
      loadCollectionSchema: () => Effect.die('unused'),
      loadCollectionSnapshot: (reference) =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            events.push(`start:${reference.modelZuid}`);
          }),
          () => Effect.sleep(5).pipe(Effect.as(snapshot(reference.modelZuid))),
          () =>
            Effect.sync(() => {
              active -= 1;
              events.push(`end:${reference.modelZuid}`);
            }),
        ),
    };
    const repeated = node('node-repeat', '6-child-one');
    const root = node('node-root', '6-root', [
      node('node-one', '6-child-one'),
      node('node-two', '6-child-two'),
      node('node-three', '6-child-three'),
      node('node-four', '6-child-four'),
      repeated,
    ]);

    const result = await Effect.runPromise(
      createSnapshotLoader(api).load(root, 'latest', 'fixture-token'),
    );

    expect(events[0]).toBe('start:6-root');
    expect(events.indexOf('end:6-root')).toBeLessThan(events.indexOf('start:6-child-one'));
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(events.filter((event) => event === 'start:6-child-one')).toHaveLength(1);
    expect(result.snapshots.size).toBe(5);
  });

  it('retains nested failures and partial snapshots without failing a healthy root', async () => {
    const api: ZestyApi = {
      loadCollectionSchema: () => Effect.die('unused'),
      loadCollectionSnapshot: (reference) =>
        reference.modelZuid === '6-broken'
          ? Effect.fail({ kind: 'network', message: 'Offline' })
          : Effect.succeed({ ...snapshot(reference.modelZuid), partial: true }),
    };
    const root = node('node-root', '6-root', [node('node-broken', '6-broken')]);
    const result = await Effect.runPromise(
      createSnapshotLoader(api).load(root, 'latest', 'fixture-token'),
    );

    expect(result.snapshots.get(snapshotQueryKey(root.reference, 'latest'))?.status).toBe(
      'partial',
    );
    expect(
      result.snapshots.get(snapshotQueryKey(root.children[0]!.reference, 'latest')),
    ).toMatchObject({ status: 'failed', error: { kind: 'network' } });
  });

  it('enforces the whole-view limit on returned snapshots', async () => {
    const requestedLimits: number[] = [];
    const api: ZestyApi = {
      loadCollectionSchema: () => Effect.die('unused'),
      loadCollectionSnapshot: (reference, _state, _token, itemLimit) => {
        requestedLimits.push(itemLimit ?? 10_000);
        return Effect.succeed(snapshot(reference.modelZuid, 5));
      },
    };
    const root = node('node-root', '6-root', [node('node-child', '6-child')]);
    const result = await Effect.runPromise(
      createSnapshotLoader(api, { viewLimit: 7 }).load(root, 'latest', 'fixture-token'),
    );
    const child = result.snapshots.get(snapshotQueryKey(root.children[0]!.reference, 'latest'));

    expect(result.totalItems).toBe(7);
    expect(requestedLimits).toEqual([7, 2]);
    expect(child).toMatchObject({ status: 'partial' });
    if (child?.status === 'partial') expect(child.snapshot.items).toHaveLength(2);
  });

  it('interrupts descendant work when the load is cancelled', async () => {
    let interrupted = false;
    const api: ZestyApi = {
      loadCollectionSchema: () => Effect.die('unused'),
      loadCollectionSnapshot: (reference) =>
        reference.modelZuid === '6-root'
          ? Effect.succeed(snapshot(reference.modelZuid))
          : Effect.never.pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted = true;
                }),
              ),
            ),
    };
    const root = node('node-root', '6-root', [node('node-child', '6-child')]);
    const fiber = Effect.runFork(createSnapshotLoader(api).load(root, 'latest', 'fixture-token'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(interrupted).toBe(true);
  });
});
