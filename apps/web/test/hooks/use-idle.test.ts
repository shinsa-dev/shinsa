import { afterEach, describe, expect, it, jest } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useIdle, useIdleValue } from '@/hooks/use-idle.ts';

const original = globalThis.requestIdleCallback;
const originalCancel = globalThis.cancelIdleCallback;

afterEach(() => {
  globalThis.requestIdleCallback = original;
  globalThis.cancelIdleCallback = originalCancel;
});

describe('useIdle', () => {
  it('turns true once the browser is idle, and stays true', async () => {
    let settle: (() => void) | null = null;
    globalThis.requestIdleCallback = ((callback: () => void) => {
      settle = callback;
      return 1;
    }) as typeof requestIdleCallback;
    globalThis.cancelIdleCallback = () => undefined;
    const { result, rerender } = renderHook(() => useIdle());
    expect(result.current).toBe(false);
    await act(async () => settle?.());
    expect(result.current).toBe(true);
    rerender();
    expect(result.current).toBe(true);
  });

  it('cancels the wait when it unmounts first', () => {
    const cancelled: number[] = [];
    globalThis.requestIdleCallback = (() => 7) as typeof requestIdleCallback;
    globalThis.cancelIdleCallback = (handle: number) => cancelled.push(handle);
    renderHook(() => useIdle()).unmount();
    expect(cancelled).toEqual([7]);
  });

  it('falls back to a timer where there is no idle callback', () => {
    jest.useFakeTimers();
    // @ts-expect-error: a browser without requestIdleCallback
    globalThis.requestIdleCallback = undefined;
    const { result, unmount } = renderHook(() => useIdle());
    expect(result.current).toBe(false);
    unmount();
    const second = renderHook(() => useIdle());
    act(() => {
      jest.advanceTimersByTime(1999);
    });
    expect(second.result.current).toBe(false);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(second.result.current).toBe(true);
  });
});

describe('useIdleValue', () => {
  it('catches up with the value once the browser is idle, and only then', async () => {
    const pending: (() => void)[] = [];
    globalThis.requestIdleCallback = ((callback: () => void) =>
      pending.push(callback)) as typeof requestIdleCallback;
    globalThis.cancelIdleCallback = () => undefined;
    const { result, rerender } = renderHook(({ value }) => useIdleValue(value), {
      initialProps: { value: 1 },
    });
    expect(result.current).toBe(1);
    expect(pending).toHaveLength(0);
    rerender({ value: 2 });
    rerender({ value: 3 });
    expect(result.current).toBe(1);
    await act(async () => pending.at(-1)?.());
    expect(result.current).toBe(3);
  });
});
