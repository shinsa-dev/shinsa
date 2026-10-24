import { afterAll, afterEach, beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { resolveSecond, subscribeToMinutes, subscribeToSeconds } from '@/lib/format/clock.ts';

describe('subscribeToMinutes', () => {
  const intervals: { tick: () => void; ms: number }[] = [];
  let clearSpy: ReturnType<typeof spyOn<typeof globalThis, 'clearInterval'>>;
  let setSpy: ReturnType<typeof spyOn<typeof globalThis, 'setInterval'>>;

  beforeAll(() => {
    setSpy = spyOn(globalThis, 'setInterval').mockImplementation(((tick: () => void, ms: number) => {
      intervals.push({ tick, ms });
      return intervals.length as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    clearSpy = spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
  });

  afterEach(() => {
    intervals.length = 0;
    clearSpy.mockClear();
  });

  afterAll(() => {
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it('shares one minute timer between listeners and notifies each of them', () => {
    const first = mock(() => undefined);
    const second = mock(() => undefined);
    const stopFirst = subscribeToMinutes(first);
    const stopSecond = subscribeToMinutes(second);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.ms).toBe(60_000);
    intervals[0]?.tick();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    stopFirst();
    stopSecond();
  });

  it('keeps ticking while a listener remains and stops after the last one leaves', () => {
    const first = mock(() => undefined);
    const second = mock(() => undefined);
    const stopFirst = subscribeToMinutes(first);
    const stopSecond = subscribeToMinutes(second);
    stopFirst();
    expect(clearSpy).not.toHaveBeenCalled();
    intervals[0]?.tick();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    stopSecond();
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh timer for a listener that arrives after the clock stopped', () => {
    subscribeToMinutes(() => undefined)();
    const stop = subscribeToMinutes(() => undefined);
    expect(intervals).toHaveLength(2);
    stop();
  });

  it('ticks the second clock once a second, on its own timer', () => {
    const stopMinutes = subscribeToMinutes(() => undefined);
    const stopSeconds = subscribeToSeconds(() => undefined);
    expect(intervals.map((interval) => interval.ms)).toEqual([60_000, 1000]);
    stopMinutes();
    stopSeconds();
  });
});

describe('resolveSecond', () => {
  it('rounds a time down to its second', () => {
    expect(resolveSecond(12_345)).toBe(12_000);
    expect(resolveSecond(12_000)).toBe(12_000);
  });
});
