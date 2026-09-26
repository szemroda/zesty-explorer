import { Effect, Exit } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestEndpoint } from './webengine-request';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestEndpoint', () => {
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
