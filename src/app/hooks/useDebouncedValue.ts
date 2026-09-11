import { useEffect, useState } from 'react';

export function useDebouncedValue(value: string, delayMs = 200, progressDelayMs = 300) {
  const [settled, setSettled] = useState(value);
  const [showProgress, setShowProgress] = useState(false);

  useEffect(() => {
    const settleTimer = window.setTimeout(() => setSettled(value), delayMs);
    const progressTimer = window.setTimeout(() => setShowProgress(true), delayMs + progressDelayMs);
    return () => {
      window.clearTimeout(settleTimer);
      window.clearTimeout(progressTimer);
    };
  }, [delayMs, progressDelayMs, value]);

  useEffect(() => {
    if (settled !== value) return;
    const resetTimer = window.setTimeout(() => setShowProgress(false), 0);
    return () => window.clearTimeout(resetTimer);
  }, [settled, value]);

  return { value: settled, showProgress } as const;
}
