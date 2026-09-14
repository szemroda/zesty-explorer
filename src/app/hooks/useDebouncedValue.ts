import { useEffect, useState } from 'react';

export function useDebouncedValue(value: string, delayMs = 25) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const settleTimer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(settleTimer);
  }, [delayMs, value]);

  return { value: settled, showProgress: settled !== value } as const;
}
