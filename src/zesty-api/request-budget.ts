import { Context, Effect, Schema } from 'effect';
import { takeBrowserRequestSlot } from './browser-request-slots';

export type RequestService = 'instances' | 'accounts' | 'webengine';
/**
 * Where a queued background request stands. The budget reads it each time it picks the next
 * request, so a caller can move work that is already queued without cancelling it.
 * - `needed` work starts before `prefetch` work, highest `rank` first.
 * - `prefetch` work also waits while the page is hidden.
 * - `dropped` work leaves the queue without being sent, failing as `cancelled`.
 * Requests of the same standing and rank start in the order they were made. Requests made under
 * one priority belong together: once one of them has started, the rest are no longer dropped, so
 * a load that sent anything completes.
 */
export type BackgroundStanding =
  { readonly kind: 'needed' | 'prefetch'; readonly rank: number } | { readonly kind: 'dropped' };

/** Interactive requests start before background ones. */
export type RequestPriority =
  | { readonly kind: 'interactive' }
  | { readonly kind: 'background'; readonly standing: () => BackgroundStanding };
class CurrentRequestPriority extends Context.Reference<CurrentRequestPriority>()(
  'zesty/RequestPriority',
  { defaultValue: (): RequestPriority => ({ kind: 'interactive' }) },
) {}

export type RequestBudgetFailure =
  | { readonly kind: 'request-budget'; readonly message: string }
  | { readonly kind: 'cancelled'; readonly message: string }
  | { readonly kind: 'rate-limit'; readonly message: string; readonly retryAt: number };

export interface RequestBudget {
  /** Queues one lazy HTTP attempt; retries reacquire admission and waits exclude HTTP timeout. */
  run<Value, Failure, Requirements>(
    service: RequestService,
    attempt: (
      rateLimited: (
        retryAfterMs: number | undefined,
      ) => Effect.Effect<number, RequestBudgetFailure>,
    ) => Effect.Effect<Value, Failure, Requirements>,
  ): Effect.Effect<Value, Failure | RequestBudgetFailure, Requirements>;
}

export interface RequestBudgetOptions {
  readonly intervalMs?: number;
  readonly dispatchWindowMs?: number;
  readonly authenticatedCooldownMs?: number;
  readonly takeSlot?: typeof takeBrowserRequestSlot;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

const timestamp = Schema.Number.pipe(Schema.finite(), Schema.nonNegative());
const cooldownsSchema = Schema.parseJson(
  Schema.Struct({
    instances: timestamp,
    accounts: timestamp,
    webengine: timestamp,
  }),
);
type Cooldowns = Schema.Schema.Type<typeof cooldownsSchema>;
const cooldownStorageKey = 'zesty-request-cooldowns';

export function withRequestPriority(priority: RequestPriority) {
  return <Value, Failure, Requirements>(effect: Effect.Effect<Value, Failure, Requirements>) =>
    Effect.provideService(effect, CurrentRequestPriority, priority);
}

/** One budget per tab. Only active HTTP slots are shared with other tabs. */
export function createRequestBudget({
  intervalMs = 100,
  dispatchWindowMs = 50,
  authenticatedCooldownMs = 60_000,
  takeSlot = takeBrowserRequestSlot,
  storage,
}: RequestBudgetOptions = {}): RequestBudget {
  if (
    [intervalMs, dispatchWindowMs, authenticatedCooldownMs].some(
      (value) => !Number.isFinite(value) || value < 0,
    )
  ) {
    throw new Error('Request budget durations must be finite and nonnegative.');
  }
  interface Admission {
    readonly release: () => void;
    readonly dispatchBefore: number;
  }
  interface Ticket {
    readonly service: RequestService;
    readonly priority: RequestPriority;
    readonly complete: (admission: Admission) => void;
    readonly fail: (failure: RequestBudgetFailure) => void;
  }
  const queue: Ticket[] = [];
  let pump: AbortController | undefined;
  let nextStartAt = 0;
  let cooldowns: Cooldowns = { instances: 0, accounts: 0, webengine: 0 };
  let initialized = false;
  let interactiveStreak = 0;
  // Wakes a pump that waits because only prefetch work is queued while the page is hidden.
  let wakePump: (() => void) | undefined;
  // Priorities that have started a request; their other requests are not dropped.
  const started = new WeakSet<RequestPriority>();
  const notNeeded: RequestBudgetFailure = {
    kind: 'cancelled',
    message: 'The request was no longer needed, so it was not sent.',
  };
  let unavailable: Extract<RequestBudgetFailure, { kind: 'request-budget' }> | undefined;
  const cooldown = (retryAt: number): Extract<RequestBudgetFailure, { kind: 'rate-limit' }> => ({
    kind: 'rate-limit',
    message: `Zesty has paused requests to this service in this tab. Retry after ${new Date(retryAt).toLocaleString()}.`,
    retryAt,
  });
  const remove = (ticket: Ticket) => {
    const index = queue.indexOf(ticket);
    if (index >= 0) queue.splice(index, 1);
    if (!queue.length) pump?.abort();
  };
  const failBudget = (message: string) => {
    unavailable = { kind: 'request-budget', message };
    for (const ticket of [...queue]) {
      remove(ticket);
      ticket.fail(unavailable);
    }
    return unavailable;
  };
  const rejectPaused = () => {
    for (const ticket of [...queue]) {
      if (cooldowns[ticket.service] <= Date.now()) continue;
      remove(ticket);
      ticket.fail(cooldown(cooldowns[ticket.service]));
    }
  };
  const pageHidden = () => globalThis.document?.visibilityState === 'hidden';
  // The next background ticket to start, dropping tickets no one needs any more on the way.
  const nextBackground = (): Ticket | undefined => {
    let next: Ticket | undefined;
    let nextTier = -1;
    let nextRank = -Infinity;
    for (const ticket of [...queue]) {
      if (ticket.priority.kind !== 'background') continue;
      const asked = ticket.priority.standing();
      // The rest of a load that already sent a request finishes first.
      const standing =
        asked.kind === 'dropped' && started.has(ticket.priority)
          ? ({ kind: 'needed', rank: Infinity } as const)
          : asked;
      if (standing.kind === 'dropped') {
        remove(ticket);
        ticket.fail(notNeeded);
        continue;
      }
      if (standing.kind === 'prefetch' && pageHidden()) continue;
      const tier = standing.kind === 'needed' ? 1 : 0;
      if (tier < nextTier || (tier === nextTier && standing.rank <= nextRank)) continue;
      next = ticket;
      nextTier = tier;
      nextRank = standing.rank;
    }
    return next;
  };
  const waitForWake = (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const wake = () => {
        wakePump = undefined;
        signal.removeEventListener('abort', wake);
        globalThis.document?.removeEventListener('visibilitychange', wake);
        resolve();
      };
      wakePump = wake;
      signal.addEventListener('abort', wake, { once: true });
      globalThis.document?.addEventListener('visibilitychange', wake);
    });
  const wait = (delay: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const aborted = () => {
        clearTimeout(timer);
        reject(new DOMException('Request admission cancelled.', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', aborted);
        resolve();
      }, delay);
      signal.addEventListener('abort', aborted, { once: true });
    });
  const startPump = () => {
    if (pump || !queue.length) return;
    const controller = new AbortController();
    pump = controller;
    void (async () => {
      while (queue.length && !controller.signal.aborted) {
        let release: (() => void) | undefined;
        try {
          release = await takeSlot(controller.signal);
          const interactive = queue.find((ticket) => ticket.priority.kind === 'interactive');
          const background = nextBackground();
          const ticket =
            interactiveStreak >= 8 && background ? background : (interactive ?? background);
          if (!ticket) {
            // Only prefetch work is left and the page is hidden: wait until it shows or work arrives.
            release();
            release = undefined;
            if (queue.length) await waitForWake(controller.signal);
            continue;
          }
          const now = Date.now();
          if (cooldowns[ticket.service] > now) {
            remove(ticket);
            ticket.fail(cooldown(cooldowns[ticket.service]));
            continue;
          }
          if (nextStartAt > now) {
            release();
            release = undefined;
            await wait(nextStartAt - now, controller.signal);
            continue;
          }
          nextStartAt = now + intervalMs + dispatchWindowMs;
          queue.splice(queue.indexOf(ticket), 1);
          interactiveStreak = ticket.priority.kind === 'interactive' ? interactiveStreak + 1 : 0;
          started.add(ticket.priority);
          ticket.complete({ release, dispatchBefore: now + dispatchWindowMs });
          release = undefined;
        } finally {
          release?.();
        }
      }
    })()
      .catch(() => {
        if (!controller.signal.aborted)
          failBudget(
            'The browser could not limit active requests. Reload the app in Chrome or Edge.',
          );
      })
      .finally(() => {
        if (pump === controller) pump = undefined;
        startPump();
      });
  };
  const acquire = (service: RequestService, priority: RequestPriority) =>
    Effect.async<Admission, RequestBudgetFailure>((resume) => {
      if (!initialized && !unavailable) {
        try {
          const saved = (storage ?? globalThis.sessionStorage).getItem(cooldownStorageKey);
          if (saved !== null) cooldowns = Schema.decodeUnknownSync(cooldownsSchema)(saved);
          initialized = true;
        } catch {
          failBudget(
            'Saved request pauses could not be read. Allow session storage and reload the app.',
          );
        }
      }
      if (unavailable) {
        resume(Effect.fail(unavailable));
        return;
      }
      if (cooldowns[service] > Date.now()) {
        resume(Effect.fail(cooldown(cooldowns[service])));
        return;
      }
      let granted: Admission | undefined;
      const ticket: Ticket = {
        service,
        priority,
        complete: (admission) => {
          granted = admission;
          resume(Effect.succeed(admission));
        },
        fail: (failure) => resume(Effect.fail(failure)),
      };
      queue.push(ticket);
      startPump();
      wakePump?.();
      return Effect.sync(() => {
        remove(ticket);
        granted?.release();
      });
    });

  return {
    run<Value, Failure, Requirements>(
      service: RequestService,
      attempt: (
        rateLimited: (hint: number | undefined) => Effect.Effect<number, RequestBudgetFailure>,
      ) => Effect.Effect<Value, Failure, Requirements>,
    ) {
      return Effect.flatMap(CurrentRequestPriority, (priority) => {
        const rateLimited = (hint: number | undefined) =>
          Effect.suspend(() => {
            const delay = hint ?? (service === 'webengine' ? 30 * 60_000 : authenticatedCooldownMs);
            const retryAt = Math.max(
              cooldowns[service],
              Date.now() + Math.max(delay, intervalMs + dispatchWindowMs),
            );
            cooldowns = { ...cooldowns, [service]: retryAt };
            rejectPaused();
            return Effect.try({
              try: () => {
                (storage ?? globalThis.sessionStorage).setItem(
                  cooldownStorageKey,
                  JSON.stringify(cooldowns),
                );
                return retryAt;
              },
              catch: () => ({
                ...cooldown(retryAt),
                message: `${cooldown(retryAt).message} This pause could not be saved. Keep this tab open.`,
              }),
            });
          });
        const run: Effect.Effect<Value, Failure | RequestBudgetFailure, Requirements> =
          Effect.uninterruptibleMask((restore) =>
            Effect.flatMap(restore(acquire(service, priority)), (admission) =>
              Effect.suspend(() => {
                if (cooldowns[service] > Date.now()) {
                  admission.release();
                  return Effect.fail(cooldown(cooldowns[service]));
                }
                if (Date.now() > admission.dispatchBefore) {
                  admission.release();
                  return restore(run);
                }
                return restore(Effect.suspend(() => attempt(rateLimited))).pipe(
                  Effect.ensuring(Effect.sync(admission.release)),
                );
              }),
            ),
          );
        return run;
      });
    },
  };
}

/** Parses exposed Retry-After seconds or HTTP dates. An absent or invalid header has no hint. */
export function retryAfterMs(
  value: string | undefined | null,
  now = Date.now(),
): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) {
    const delay = Number(text) * 1_000;
    return Number.isFinite(delay) ? delay : undefined;
  }
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*[, ]/.test(text)) return undefined;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export const defaultRequestBudget = createRequestBudget();
