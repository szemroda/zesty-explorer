/** Claims one of four active HTTP slots shared by tabs on this origin. */
export function takeBrowserRequestSlot(signal: AbortSignal): Promise<() => void> {
  if (!globalThis.navigator?.locks) {
    return Promise.reject(new Error('Web Locks are unavailable.'));
  }
  return new Promise<() => void>((resolve, reject) => {
    signal.throwIfAborted();
    const race = new AbortController();
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      race.abort();
      signal.removeEventListener('abort', aborted);
      reject(error instanceof Error ? error : new Error('Request slot failed.', { cause: error }));
    };
    const aborted = () => fail(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    for (let slot = 0; slot < 4; slot += 1) {
      void navigator.locks
        .request(`zesty-request-slot-${slot}`, { signal: race.signal }, async () => {
          if (settled || signal.aborted) return;
          settled = true;
          signal.removeEventListener('abort', aborted);
          race.abort();
          await new Promise<void>((release) => resolve(release));
        })
        .catch((error: unknown) => {
          if (!race.signal.aborted) fail(error);
        });
    }
  });
}
