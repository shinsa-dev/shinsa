import { afterEach, describe, expect, it, jest, spyOn } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useDelay } from '@/hooks/use-delay.ts';

afterEach(() => {
  jest.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('useDelay', () => {
  it('runs the latest callback once the delay has passed', () => {
    jest.useFakeTimers();
    const seen: string[] = [];
    const { rerender } = renderHook(({ name }) => useDelay(() => seen.push(name), 100), {
      initialProps: { name: 'a' },
    });
    advance(50);
    rerender({ name: 'b' });
    advance(50);
    expect(seen).toEqual(['b']);
  });

  it('waits while the delay is null and starts again when its deps change', () => {
    jest.useFakeTimers();
    let runs = 0;
    const { rerender } = renderHook(({ delay, key }) => useDelay(() => (runs += 1), delay, [key]), {
      initialProps: { delay: null as number | null, key: 1 },
    });
    advance(500);
    expect(runs).toBe(0);
    rerender({ delay: 100, key: 1 });
    advance(60);
    rerender({ delay: 100, key: 2 });
    advance(60);
    expect(runs).toBe(0);
    advance(40);
    expect(runs).toBe(1);
  });

  it('never runs after unmount', () => {
    jest.useFakeTimers();
    let runs = 0;
    const { unmount } = renderHook(() => useDelay(() => (runs += 1), 100));
    advance(50);
    unmount();
    advance(500);
    expect(runs).toBe(0);
  });

  it('reports a callback that throws instead of dropping it', () => {
    jest.useFakeTimers();
    const reported = spyOn(globalThis, 'reportError').mockImplementation(() => undefined);
    const failure = new Error('delayed');
    renderHook(() =>
      useDelay(() => {
        throw failure;
      }, 100)
    );
    advance(100);
    expect(reported).toHaveBeenCalledWith(failure);
    reported.mockRestore();
  });
});
