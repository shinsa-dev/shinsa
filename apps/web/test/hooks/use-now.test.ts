import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useNow } from '@/hooks/use-now.ts';
import { NOW } from '../support/state.ts';

const ticks: (() => void)[] = [];

let setSpy: ReturnType<typeof spyOn<typeof globalThis, 'setInterval'>>;
let clearSpy: ReturnType<typeof spyOn<typeof globalThis, 'clearInterval'>>;

beforeEach(() => {
  setSpy = spyOn(globalThis, 'setInterval').mockImplementation(((tick: () => void) => {
    ticks.push(tick);
    return ticks.length as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval);
  clearSpy = spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
});

afterEach(() => {
  ticks.length = 0;
  setSpy.mockRestore();
  clearSpy.mockRestore();
  setSystemTime();
});

describe('useNow', () => {
  it('starts at the current second and moves on each tick of one shared timer', () => {
    setSystemTime(NOW + 400);
    const first = renderHook(() => useNow());
    const second = renderHook(() => useNow());
    expect(first.result.current).toBe(NOW);
    expect(ticks).toHaveLength(1);
    setSystemTime(NOW + 60_000);
    act(() => ticks[0]?.());
    expect([first.result.current, second.result.current]).toEqual([NOW + 60_000, NOW + 60_000]);
    first.unmount();
    second.unmount();
  });

  it('stops the timer once the last clock unmounts', () => {
    const first = renderHook(() => useNow());
    const second = renderHook(() => useNow());
    first.unmount();
    expect(clearSpy).not.toHaveBeenCalled();
    second.unmount();
    expect(clearSpy).toHaveBeenCalledWith(1);
  });
});
