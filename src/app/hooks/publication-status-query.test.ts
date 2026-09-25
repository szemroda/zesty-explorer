import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { ContentItem, ContentItemReference, ItemZuid } from '../../domain';
import type { ItemVersionApi } from '../../zesty-api';
import { loadPublicationStatus } from './publication-status-query';

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

describe('loadPublicationStatus', () => {
  it('loads at most four rows at once and skips a row aborted while waiting', async () => {
    let releaseVersions = () => {};
    const versionsReleased = new Promise<void>((resolve) => {
      releaseVersions = resolve;
    });
    const started: ItemZuid[] = [];
    let active = 0;
    let peak = 0;
    const api: ItemVersionApi = {
      loadItemVersions: (reference) =>
        Effect.promise(async () => {
          started.push(reference.itemZuid);
          active += 1;
          peak = Math.max(peak, active);
          await versionsReleased;
          active -= 1;
          return [{ number: 1, item }];
        }),
      loadItemPublishings: () => Effect.succeed([]),
      loadInstanceUsers: () => Effect.succeed([]),
    };
    const source = { api, sessionToken: 'token', credentialRevision: 'revision' };
    const itemZuids: readonly ItemZuid[] = [
      '7-row-1',
      '7-row-2',
      '7-row-3',
      '7-row-4',
      '7-row-5',
      '7-row-6',
    ];
    const rows = itemZuids.map((itemZuid) => {
      const controller = new AbortController();
      const status = loadPublicationStatus(source, referenceFor(itemZuid), item, controller.signal);
      return { itemZuid, controller, status };
    });

    await vi.waitFor(() => expect(started).toHaveLength(4));
    const [, , , , waiting, last] = rows;
    if (!waiting || !last) throw new Error('Expected six rows.');
    waiting.controller.abort();
    await expect(waiting.status).rejects.toThrow();

    releaseVersions();
    await Promise.all(rows.filter((row) => row !== waiting).map((row) => row.status));
    expect(peak).toBe(4);
    expect(started).toHaveLength(5);
    expect(started).toContain(last.itemZuid);
    expect(started).not.toContain(waiting.itemZuid);
  });
});
