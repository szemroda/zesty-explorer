import { Effect, Exit } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  requestEndpoint as requestWithBrowserBudget,
  type EndpointRequestOptions,
} from './webengine-request';
import {
  immediateRequestBudget,
  memoryRequestSlots,
  memoryCooldownStorage,
} from '../test/request-budget';
import { createRequestBudget, type RequestBudget } from './request-budget';

function requestEndpoint(url: string, options: EndpointRequestOptions = {}) {
  return requestWithBrowserBudget(url, { budget: immediateRequestBudget(), ...options });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestEndpoint', () => {
  it('aborts HTTP if saving a cooldown stalls after the 429 headers arrive', async () => {
    const admission = immediateRequestBudget();
    const budget: RequestBudget = {
      run(service, attempt) {
        return admission.run(service, () => attempt(() => Effect.never));
      },
    };
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return Promise.resolve(new Response('slow down', { status: 429 }));
    });
    expect(
      await Effect.runPromiseExit(
        requestEndpoint('https://site.test/stalled-pause', { budget, timeoutMs: 10 }),
      ),
    ).toEqual(Exit.fail({ kind: 'timeout' }));
    expect(signal?.aborted).toBe(true);
  });

  it('times out stalled body reading, cancels the stream, and frees its shared slot', async () => {
    const budget = createRequestBudget({
      takeSlot: memoryRequestSlots(1),
      storage: memoryCooldownStorage(),
      intervalMs: 0,
    });
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(stream))
      .mockResolvedValueOnce(new Response('next response'));
    vi.stubGlobal('fetch', fetch);
    expect(
      await Effect.runPromiseExit(
        requestEndpoint('https://site.test/stalled', { budget, timeoutMs: 10 }),
      ),
    ).toEqual(Exit.fail({ kind: 'timeout' }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(
      await Effect.runPromise(requestEndpoint('https://site.test/next', { budget })),
    ).toMatchObject({ status: 200, body: 'next response' });
  });

  it('preserves an actual 429 body, never replays it, and restores its pause on reload', async () => {
    const storage = memoryCooldownStorage();
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response('Too many requests', { status: 429 })),
    );
    vi.stubGlobal('fetch', fetch);
    const before = Date.now();
    const response = await Effect.runPromise(
      requestEndpoint('https://site.test/limited', {
        budget: createRequestBudget({ takeSlot: memoryRequestSlots(), storage }),
      }),
    );
    expect(response).toMatchObject({
      status: 429,
      body: 'Too many requests',
      rateLimit: { kind: 'cooldown' },
    });
    expect(
      response.rateLimit?.kind === 'cooldown' && response.rateLimit.retryAt,
    ).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(
      await Effect.runPromise(
        requestEndpoint('https://other-site.test/limited', {
          budget: createRequestBudget({ takeSlot: memoryRequestSlots(), storage }),
        }).pipe(Effect.either),
      ),
    ).toMatchObject({ _tag: 'Left', left: { kind: 'rate-limit' } });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps the raw 429 visible when its cooldown cannot be saved', async () => {
    const budget = createRequestBudget({
      takeSlot: memoryRequestSlots(),
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('storage denied');
        },
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response('slow down', { status: 429, headers: { 'retry-after': '2' } })),
    );
    vi.stubGlobal('fetch', fetch);
    expect(
      await Effect.runPromise(requestEndpoint('https://site.test/limited', { budget })),
    ).toMatchObject({ status: 429, body: 'slow down', rateLimit: { kind: 'unavailable' } });
    expect(
      await Effect.runPromise(
        requestEndpoint('https://site.test/limited', { budget }).pipe(Effect.either),
      ),
    ).toMatchObject({ _tag: 'Left', left: { kind: 'rate-limit' } });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('sends an anonymous GET and reports the response', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response('{"ok":true}', {
          status: 201,
          statusText: 'Created',
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);

    const response = await Effect.runPromise(requestEndpoint('https://site.test/a.json'));

    expect(response).toMatchObject({
      status: 201,
      statusText: 'Created',
      contentType: 'application/json',
      body: '{"ok":true}',
      bytes: 11,
      truncated: false,
    });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.credentials).toBe('omit');
    expect(init?.headers).toBeUndefined();
    expect(init?.method).toBeUndefined();
  });

  it('stops reading at the size limit and keeps what arrived', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('0123456789')));

    const response = await Effect.runPromise(
      requestEndpoint('https://site.test/big', { limitBytes: 4 }),
    );

    expect(response).toMatchObject({ body: '0123', bytes: 4, truncated: true });
  });

  it('reports an unreadable response without guessing its status', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

    const exit = await Effect.runPromiseExit(requestEndpoint('https://site.test/error'));

    expect(exit).toEqual(Exit.fail({ kind: 'unreadable' }));
  });

  it('times out and aborts the request', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<never>(() => {});
    });

    const exit = await Effect.runPromiseExit(
      requestEndpoint('https://site.test/slow', { timeoutMs: 10 }),
    );

    expect(exit).toEqual(Exit.fail({ kind: 'timeout' }));
    expect(signal?.aborted).toBe(true);
  });
});
