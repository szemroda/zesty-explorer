import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseInstanceReference } from '../collection-reference';
import { memoryCooldownStorage, memoryRequestSlots } from '../test/request-budget';
import { fetchZestyTransport } from './fetch-transport';
import { createRequestBudget } from './request-budget';
import { createZestyApi } from './zesty-api';

afterEach(() => vi.unstubAllGlobals());

describe('authenticated HTTP rate limits', () => {
  it.each(['stalled', 'broken'] as const)(
    'handles a 429 before reading its %s body and closes HTTP',
    async (bodyState) => {
      const parsed = parseInstanceReference('https://8-abc123.manager.zesty.io/');
      if (!parsed.ok) throw new Error('Test instance must parse');
      let signal: AbortSignal | undefined;
      const fetch = vi.fn<typeof globalThis.fetch>((_url, init) => {
        signal = init?.signal ?? undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            if (bodyState === 'broken') controller.error(new Error('body failed'));
          },
        });
        return Promise.resolve(
          new Response(stream, { status: 429, headers: { 'retry-after': '60' } }),
        );
      });
      vi.stubGlobal('fetch', fetch);
      const storage = memoryCooldownStorage();
      const budget = createRequestBudget({
        takeSlot: memoryRequestSlots(1),
        storage,
        intervalMs: 0,
      });
      const api = createZestyApi(fetchZestyTransport, {
        budget,
        timeoutMs: 100,
        retryDelaysMs: [0, 0, 0],
      });

      const failure = await Effect.runPromise(
        api.loadCollectionCatalog(parsed.value, 'token').pipe(Effect.flip),
      );
      expect(failure).toMatchObject({ kind: 'rate-limit', diagnostic: { responseStatus: 429 } });
      expect(signal?.aborted).toBe(true);
      const saved: unknown = JSON.parse(storage.getItem('zesty-request-cooldowns') ?? 'null');
      expect(saved).toEqual({
        instances: failure.kind === 'rate-limit' ? failure.retryAt : undefined,
        accounts: 0,
        webengine: 0,
      });
      expect(
        await Effect.runPromise(api.loadCollectionCatalog(parsed.value, 'token').pipe(Effect.flip)),
      ).toMatchObject({ kind: 'rate-limit' });
      expect(fetch).toHaveBeenCalledOnce();
      expect(
        await Effect.runPromise(budget.run('accounts', () => Effect.succeed('slot released'))),
      ).toBe('slot released');
    },
  );
});
