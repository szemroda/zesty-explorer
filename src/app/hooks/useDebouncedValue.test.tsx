import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

afterEach(() => vi.useRealTimers());

describe('useDebouncedValue', () => {
  it('clears progress when the value settles and keeps it cleared', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }: { readonly value: string }) => useDebouncedValue(value),
      { initialProps: { value: '' } },
    );

    rerender({ value: 'Harry' });
    expect(result.current.showProgress).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });
    expect(result.current).toEqual({ value: 'Harry', showProgress: false });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.showProgress).toBe(false);
  });
});
