import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  generateRelationshipGraph,
  type CollectionSchema,
  type CollectionSnapshot,
} from '../domain';
import { collectionNode as node } from '../test/fixtures';
import type { CollectionApi } from '../zesty-api';
import { loadCollection, loadView, ViewLoadError } from './load-view';

const generated = generateRelationshipGraph(3);
const schema: CollectionSchema = {
  modelZuid: '6-root',
  label: 'Root',
  fields: [],
};

function snapshot(
  modelZuid: `6-${string}`,
  items: CollectionSnapshot['items'] = generated.parents.items,
): CollectionSnapshot {
  return {
    ...generated.parents,
    id: `snapshot-${modelZuid}`,
    modelZuid,
    items,
    itemsById: new Map(items.map((item) => [item.id, item])),
  };
}

describe('view loading', () => {
  it('deduplicates collection identities and spends the shared budget before starting more work', async () => {
    const repeated = node('node-repeat', '6-child');
    const skipped = node('node-skipped', '6-skipped');
    const root = node('node-root', '6-root', [node('node-child', '6-child'), repeated, skipped]);
    const rootItems = Array.from(
      { length: 49_998 },
      (_, index) => generated.parents.items[index % generated.parents.items.length]!,
    );
    const limits: number[] = [];
    const models: string[] = [];

    const loaded = await loadView(
      root,
      'latest',
      { schema, snapshot: snapshot('6-root', rootItems) },
      (collection, itemLimit) => {
        limits.push(itemLimit);
        models.push(collection.reference.modelZuid);
        return Promise.resolve({
          schema: { ...schema, modelZuid: collection.reference.modelZuid },
          snapshot: snapshot('6-child', generated.children.items.slice(0, itemLimit)),
        });
      },
    );

    expect(limits).toEqual([2]);
    expect(models).toEqual(['6-child']);
    expect(loaded.schemas.has(repeated.id)).toBe(true);
    expect(loaded.snapshots.totalItems).toBe(50_000);
    expect(
      loaded.snapshots.snapshots.get('8-fixture-instance:production:6-skipped:latest:en-US'),
    ).toMatchObject({ status: 'partial', snapshot: { partial: true, items: [] } });
    expect(loaded.schemaErrors.get(skipped.id)).toMatchObject({
      kind: 'data-limit',
      scope: 'view',
    });
  });

  it('interrupts Effect work when its query signal is aborted', async () => {
    let interrupted = false;
    const root = node('node-root', '6-root');
    const api: CollectionApi = {
      loadCollectionCatalog: () => Effect.succeed({ collections: [], incomplete: false }),
      loadCollectionSchema: () => Effect.succeed(schema),
      loadCollectionSnapshot: () =>
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        ),
    };
    const controller = new AbortController();
    const pending = loadCollection(api, root, 'latest', 'token', 10_000, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(interrupted).toBe(true);
  });

  it('surfaces typed root failures', async () => {
    const api: CollectionApi = {
      loadCollectionCatalog: () => Effect.succeed({ collections: [], incomplete: false }),
      loadCollectionSchema: () => Effect.fail({ kind: 'network', message: 'Offline' }),
      loadCollectionSnapshot: () => Effect.succeed(snapshot('6-root')),
    };
    await expect(
      loadCollection(api, node('node-root', '6-root'), 'latest', 'token', 10_000),
    ).rejects.toBeInstanceOf(ViewLoadError);
  });
});
