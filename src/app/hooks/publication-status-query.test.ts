import { hashKey, QueryClient, QueryObserver } from '@tanstack/react-query';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { ContentItem, ContentItemReference, ItemZuid } from '../../domain';
import {
  countSavedVersionsOnScreen,
  loadSavedVersions,
  savedVersionsQueryPrefix,
  refreshActiveSavedVersions,
  type PublicationStatusSource,
} from './publication-status-query';
import { createRequestBudget } from '../../zesty-api/request-budget';
import { memoryRequestSlots, memoryCooldownStorage } from '../../test/request-budget';

const item: ContentItem = { id: '7-example', fields: {}, metadata: { version: 1 }, raw: {} };

function referenceFor(itemZuid: ItemZuid): ContentItemReference {
  return {
    instanceZuid: '8-instance',
    modelZuid: '6-model',
    itemZuid,
    deployment: 'production',
    area: 'content',
    apiBaseUrl: 'https://8-instance.api.zesty.io/v1',
    managerBaseUrl: 'https://8-instance.manager.zesty.io',
  };
}

describe('loadSavedVersions', () => {
  it('shares four HTTP slots with interactive work and skips requests for a dropped row', async () => {
    const budget = createRequestBudget({
      takeSlot: memoryRequestSlots(),
      storage: memoryCooldownStorage(),
      intervalMs: 0,
    });
    let releaseVersions = () => {};
    const versionsReleased = new Promise<void>((resolve) => {
      releaseVersions = resolve;
    });
    const started: string[] = [];
    let active = 0;
    let peak = 0;
    const api: PublicationStatusSource['api'] = {
      loadItemVersions: (reference) =>
        budget.run('instances', () =>
          Effect.promise(async () => {
            started.push(reference.itemZuid);
            active += 1;
            peak = Math.max(peak, active);
            await versionsReleased;
            active -= 1;
            return [{ number: 1, item }];
          }),
        ),
      loadModelPublishings: () => Effect.succeed([]),
    };
    const source = {
      api,
      sessionToken: 'token',
      credentialRevision: 'revision',
      contentState: 'published' as const,
    };
    const itemZuids: readonly ItemZuid[] = [
      '7-row-1',
      '7-row-2',
      '7-row-3',
      '7-row-4',
      '7-row-5',
      '7-row-6',
    ];
    const dropped = new Set<ItemZuid>();
    const rows = itemZuids.map((itemZuid) => {
      const versions = loadSavedVersions(source, referenceFor(itemZuid), () =>
        dropped.has(itemZuid) ? { kind: 'dropped' } : { kind: 'needed', rank: 0 },
      );
      return { itemZuid, versions };
    });

    await vi.waitFor(() => expect(started).toHaveLength(4));
    const interactive = Effect.runPromise(
      budget.run('instances', () =>
        Effect.sync(() => {
          started.push('interactive');
        }),
      ),
    );
    const [, , , , waiting, last] = rows;
    if (!waiting || !last) throw new Error('Expected six rows.');
    dropped.add(waiting.itemZuid);
    releaseVersions();
    await expect(waiting.versions).rejects.toThrow();
    const loaded = await Promise.all(
      rows.filter((row) => row !== waiting).map((row) => row.versions),
    );
    await interactive;
    expect(peak).toBe(4);
    expect(started).toEqual(['7-row-1', '7-row-2', '7-row-3', '7-row-4', 'interactive', '7-row-6']);
    expect(loaded).toEqual(Array.from({ length: 5 }, () => [{ number: 1 }]));
  });

  it('waits on Refresh only for statuses on screen, and reloads the rest in the background', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const loads: string[] = [];
    const show = (name: string, reload: () => Promise<string>) => {
      let loaded = false;
      return new QueryObserver(client, {
        queryKey: [...savedVersionsQueryPrefix, name],
        queryFn: () => {
          loads.push(name);
          if (loaded) return reload();
          loaded = true;
          return Promise.resolve(name);
        },
        staleTime: Infinity,
      }).subscribe(() => {});
    };
    show('on-screen', () => Promise.resolve('on-screen'));
    // Below the screen, waiting while the tab is hidden: its reload does not settle.
    show('below', () => new Promise<string>(() => {}));
    await vi.waitFor(() =>
      expect(
        ['on-screen', 'below'].map((name) =>
          client.getQueryData([...savedVersionsQueryPrefix, name]),
        ),
      ).toEqual(['on-screen', 'below']),
    );
    const leaveScreen = countSavedVersionsOnScreen(
      hashKey([...savedVersionsQueryPrefix, 'on-screen']),
    );

    expect(await refreshActiveSavedVersions(client)).toBe(true);
    expect(loads.toSorted()).toEqual(['below', 'below', 'on-screen', 'on-screen']);
    leaveScreen();
  });
});
