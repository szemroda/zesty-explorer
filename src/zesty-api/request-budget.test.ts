import { Effect, Exit } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryCooldownStorage, memoryRequestSlots } from '../test/request-budget';
import { createRequestBudget, retryAfterMs, withRequestPriority } from './request-budget';

afterEach(() => vi.useRealTimers());

describe('per-tab request admission', () => {
  it('paces all services within a tab and releases their active slots', async () => {
    vi.useFakeTimers();
    const budget = createRequestBudget({
      takeSlot: memoryRequestSlots(),
      storage: memoryCooldownStorage(),
    });
    const starts: number[] = [];
    let active = 0;
    let peak = 0;
    const work = Array.from({ length: 8 }, (_, index) =>
      Effect.runPromise(
        budget.run(index % 2 ? 'accounts' : 'instances', () =>
          Effect.sync(() => {
            starts.push(Date.now());
            active += 1;
            peak = Math.max(peak, active);
          }).pipe(
            Effect.zipRight(Effect.sleep(2_000)),
            Effect.ensuring(
              Effect.sync(() => {
                active -= 1;
              }),
            ),
          ),
        ),
      ),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all(work);
    expect(starts).toHaveLength(8);
    expect(starts.slice(1).every((start, index) => start - starts[index]! >= 250)).toBe(true);
    expect(peak).toBe(4);
    expect(active).toBe(0);
  });

  it('shares only active slots between tabs, with independent start schedules', async () => {
    vi.useFakeTimers();
    const takeSlot = memoryRequestSlots();
    const budgets = [
      createRequestBudget({ takeSlot, storage: memoryCooldownStorage() }),
      createRequestBudget({ takeSlot, storage: memoryCooldownStorage() }),
    ];
    const starts: number[][] = [[], []];
    let active = 0;
    let peak = 0;
    const work = budgets.flatMap((budget, tab) =>
      Array.from({ length: 4 }, () =>
        Effect.runPromise(
          budget.run('instances', () =>
            Effect.sync(() => {
              starts[tab]!.push(Date.now());
              active += 1;
              peak = Math.max(peak, active);
            }).pipe(
              Effect.zipRight(Effect.sleep(2_000)),
              Effect.ensuring(
                Effect.sync(() => {
                  active -= 1;
                }),
              ),
            ),
          ),
        ),
      ),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all(work);
    expect(starts.map((times) => times.length)).toEqual([4, 4]);
    expect(starts[0]![0]).toBe(starts[1]![0]);
    for (const times of starts)
      expect(times.slice(1).every((start, index) => start - times[index]! >= 250)).toBe(true);
    expect(peak).toBe(4);
  });

  it('gives foreground work priority and admits background work after eight foreground starts', async () => {
    vi.useFakeTimers();
    const takeSlot = memoryRequestSlots(1);
    const release = await takeSlot(new AbortController().signal);
    const budget = createRequestBudget({
      takeSlot,
      storage: memoryCooldownStorage(),
      intervalMs: 0,
      dispatchWindowMs: 10,
    });
    const order: string[] = [];
    const background = Effect.runPromise(
      budget
        .run('instances', () =>
          Effect.sync(() => {
            order.push('badge');
          }),
        )
        .pipe(withRequestPriority('background')),
    );
    const foreground = Array.from({ length: 10 }, (_, index) =>
      Effect.runPromise(
        budget.run('instances', () =>
          Effect.sync(() => {
            order.push(`open-${index}`);
          }),
        ),
      ),
    );
    release();
    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([background, ...foreground]);
    expect(order).toEqual([
      'open-0',
      'open-1',
      'open-2',
      'open-3',
      'open-4',
      'open-5',
      'open-6',
      'open-7',
      'badge',
      'open-8',
      'open-9',
    ]);
  });

  it('never executes cancelled queued work and releases active work on interruption', async () => {
    const budget = createRequestBudget({
      takeSlot: memoryRequestSlots(1),
      storage: memoryCooldownStorage(),
      intervalMs: 0,
    });
    const started = vi.fn();
    const activeController = new AbortController();
    const active = Effect.runPromiseExit(
      budget.run('instances', () => Effect.sync(started).pipe(Effect.zipRight(Effect.never))),
      { signal: activeController.signal },
    );
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    const queuedController = new AbortController();
    const queuedAttempt = vi.fn(() => Effect.void);
    const queued = Effect.runPromiseExit(budget.run('instances', queuedAttempt), {
      signal: queuedController.signal,
    });
    queuedController.abort();
    activeController.abort();
    expect(Exit.isInterrupted(await queued)).toBe(true);
    expect(Exit.isInterrupted(await active)).toBe(true);
    await Effect.runPromise(budget.run('accounts', () => Effect.void));
    expect(queuedAttempt).not.toHaveBeenCalled();
  });

  it('rejects paused queued work promptly, even while it waits for a shared slot', async () => {
    const budget = createRequestBudget({
      takeSlot: memoryRequestSlots(1),
      storage: memoryCooldownStorage(),
      intervalMs: 0,
    });
    let report429 = () => {};
    const responseReady = new Promise<void>((resolve) => {
      report429 = resolve;
    });
    const started = vi.fn();
    const response = Effect.runPromise(
      budget.run('instances', (rateLimited) =>
        Effect.sync(started).pipe(
          Effect.zipRight(Effect.promise(() => responseReady)),
          Effect.zipRight(rateLimited(60_000)),
        ),
      ),
    );
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    const attempt = vi.fn(() => Effect.void);
    const queued = Effect.runPromise(budget.run('instances', attempt).pipe(Effect.either));
    report429();
    const retryAt = await response;
    expect(await queued).toMatchObject({ _tag: 'Left', left: { kind: 'rate-limit', retryAt } });
    expect(
      await Effect.runPromise(budget.run('instances', attempt).pipe(Effect.either)),
    ).toMatchObject({ _tag: 'Left', left: { kind: 'rate-limit', retryAt } });
    await Effect.runPromise(budget.run('accounts', () => Effect.void));
    expect(attempt).not.toHaveBeenCalled();
  });

  it('restores only cooldown deadlines on reload while another tab stays independent', async () => {
    const storage = memoryCooldownStorage();
    const takeSlot = memoryRequestSlots();
    const budget = createRequestBudget({ takeSlot, storage });
    expect(storage.getItem('zesty-request-cooldowns')).toBeNull();
    const retryAt = await Effect.runPromise(
      budget.run('instances', (rateLimited) => rateLimited(60_000)),
    );
    expect(JSON.parse(storage.getItem('zesty-request-cooldowns') ?? 'null')).toEqual({
      instances: retryAt,
      accounts: 0,
      webengine: 0,
    });
    const attempt = vi.fn(() => Effect.succeed('loaded'));
    const reloaded = createRequestBudget({ takeSlot, storage });
    expect(
      await Effect.runPromise(reloaded.run('instances', attempt).pipe(Effect.either)),
    ).toMatchObject({ _tag: 'Left', left: { kind: 'rate-limit', retryAt } });
    const otherTab = createRequestBudget({ takeSlot, storage: memoryCooldownStorage() });
    expect(await Effect.runPromise(otherTab.run('instances', attempt))).toBe('loaded');
    expect(attempt).toHaveBeenCalledOnce();
  });

  it('keeps the live cooldown when sessionStorage cannot save it', async () => {
    const budget = createRequestBudget({
      takeSlot: memoryRequestSlots(),
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('storage denied');
        },
      },
    });
    const failure = await Effect.runPromise(
      budget.run('instances', (rateLimited) => rateLimited(60_000)).pipe(Effect.flip),
    );
    expect(failure.kind).toBe('rate-limit');
    expect(failure.message).toContain('Keep this tab open');
    const attempt = vi.fn(() => Effect.void);
    expect(
      await Effect.runPromise(budget.run('instances', attempt).pipe(Effect.flip)),
    ).toMatchObject({ kind: 'rate-limit' });
    expect(attempt).not.toHaveBeenCalled();
    await Effect.runPromise(budget.run('accounts', () => Effect.void));
  });

  it('never shortens a cooldown and uses the documented WebEngine ban when the header is hidden', async () => {
    const budget = createRequestBudget({
      takeSlot: memoryRequestSlots(),
      storage: memoryCooldownStorage(),
    });
    const before = Date.now();
    const retryAt = await Effect.runPromise(
      budget.run('webengine', (rateLimited) =>
        rateLimited(undefined).pipe(
          Effect.flatMap((long) =>
            rateLimited(1_000).pipe(Effect.map((short) => ({ long, short }))),
          ),
        ),
      ),
    );
    expect(retryAt.long).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(retryAt.short).toBe(retryAt.long);
  });

  it.each(['not JSON', '{"instances":-1,"accounts":0,"webengine":0}'])(
    'fails explicitly when stored cooldowns are unreadable (%s)',
    async (saved) => {
      const storage = memoryCooldownStorage();
      storage.setItem('zesty-request-cooldowns', saved);
      const budget = createRequestBudget({ takeSlot: memoryRequestSlots(), storage });
      const attempt = vi.fn(() => Effect.void);
      expect(
        await Effect.runPromise(budget.run('instances', attempt).pipe(Effect.flip)),
      ).toMatchObject({ kind: 'request-budget' });
      expect(attempt).not.toHaveBeenCalled();
    },
  );

  it('fails without HTTP if the browser cannot acquire a slot', async () => {
    const budget = createRequestBudget({
      takeSlot: () => Promise.reject(new Error('Web Locks unavailable')),
      storage: memoryCooldownStorage(),
    });
    const attempt = vi.fn(() => Effect.void);
    expect(
      await Effect.runPromise(budget.run('instances', attempt).pipe(Effect.flip)),
    ).toMatchObject({ kind: 'request-budget' });
    expect(attempt).not.toHaveBeenCalled();
  });
});

describe('Retry-After', () => {
  it('accepts seconds and HTTP dates, clamps past dates, and rejects invalid headers', () => {
    const now = Date.parse('Fri, 09 Oct 2026 12:00:00 GMT');
    expect(retryAfterMs(' 15 ', now)).toBe(15_000);
    expect(retryAfterMs('Fri, 09 Oct 2026 12:00:03 GMT', now)).toBe(3_000);
    expect(retryAfterMs('Fri, 09 Oct 2026 11:59:00 GMT', now)).toBe(0);
    for (const value of [undefined, '', '-1', '1.5', 'Infinity', 'tomorrow', '2026-10-09'])
      expect(retryAfterMs(value, now)).toBeUndefined();
  });
});
