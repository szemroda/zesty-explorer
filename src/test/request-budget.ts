import { createRequestBudget } from '../zesty-api/request-budget';

/** Shares active HTTP slots between scheduler instances in behavioral tests. */
export function memoryRequestSlots(capacity = 4) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return (signal: AbortSignal) =>
    new Promise<() => void>((resolve, reject) => {
      signal.throwIfAborted();
      const remove = () => {
        const index = waiting.indexOf(start);
        if (index >= 0) waiting.splice(index, 1);
        signal.removeEventListener('abort', aborted);
      };
      const aborted = () => {
        remove();
        reject(new DOMException('Request admission cancelled.', 'AbortError'));
      };
      const start = () => {
        if (active >= capacity) return;
        remove();
        active += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          active -= 1;
          waiting[0]?.();
        });
      };
      signal.addEventListener('abort', aborted, { once: true });
      waiting.push(start);
      start();
    });
}

export function memoryCooldownStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

export function immediateRequestBudget() {
  return createRequestBudget({
    takeSlot: memoryRequestSlots(),
    storage: memoryCooldownStorage(),
    intervalMs: 0,
  });
}
