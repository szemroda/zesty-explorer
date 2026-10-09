import { Context, Effect, Schema } from 'effect';
import { takeBrowserRequestSlot } from './browser-request-slots';

export type RequestService = 'instances' | 'accounts' | 'webengine';
export type RequestPriority = 'interactive' | 'background';
class CurrentRequestPriority extends Context.Reference<CurrentRequestPriority>()(
  'zesty/RequestPriority',
  { defaultValue: (): RequestPriority => 'interactive' },
) {}

export type RequestBudgetFailure =
  | { readonly kind: 'request-budget'; readonly message: string }
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
  intervalMs = 250,
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
          const background = queue.find((ticket) => ticket.priority === 'background');
          const interactive = queue.find((ticket) => ticket.priority === 'interactive');
          const ticket =
            interactiveStreak >= 8 && background ? background : (interactive ?? background);
          if (!ticket) break;
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
          interactiveStreak = ticket.priority === 'interactive' ? interactiveStreak + 1 : 0;
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
