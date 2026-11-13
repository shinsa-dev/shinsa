import { afterEach, beforeEach, describe, expect, it, jest, setSystemTime } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useNow } from '@/hooks/use-now.ts';
import { NOW } from '../support/state.ts';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  setSystemTime();
});

describe('useNow', () => {
  it('starts at the current second and moves on each tick of one shared timer', () => {
    setSystemTime(NOW + 400);
    const first = renderHook(() => useNow());
    const second = renderHook(() => useNow());
    expect(first.result.current).toBe(NOW);
    expect(jest.getTimerCount()).toBe(1);
    act(() => {
      setSystemTime(NOW + 59_000);
      jest.advanceTimersByTime(1000);
    });
    expect([first.result.current, second.result.current]).toEqual([NOW + 60_000, NOW + 60_000]);
    first.unmount();
    second.unmount();
  });

  it('stops the timer once the last clock unmounts', () => {
    const first = renderHook(() => useNow());
    const second = renderHook(() => useNow());
    first.unmount();
    expect(jest.getTimerCount()).toBe(1);
    second.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
