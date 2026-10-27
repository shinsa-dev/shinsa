import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { SPOTLIGHT_HOLD_MS, useSpotlight } from '@/hooks/use-spotlight.ts';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the spotlight on a place you jump to', () => {
  it('lights the place, lets it go after a moment, and lights it again on the next jump to it', () => {
    const { result, rerender } = renderHook(({ key, request }) => useSpotlight(key, request), {
      initialProps: { key: 'flow' as string | null, request: 0 },
    });
    expect(result.current).toBe('flow');
    act(() => {
      jest.advanceTimersByTime(SPOTLIGHT_HOLD_MS);
    });
    expect(result.current).toBeNull();
    rerender({ key: 'flow', request: 1 });
    expect(result.current).toBe('flow');
    rerender({ key: null, request: 1 });
    expect(result.current).toBeNull();
  });

  it('lights nothing without a place', () => {
    const { result } = renderHook(() => useSpotlight(null));
    expect(result.current).toBeNull();
  });
});
