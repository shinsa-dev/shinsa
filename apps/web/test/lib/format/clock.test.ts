import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test';
import { resolveSecond, subscribeToMinutes, subscribeToSeconds } from '@/lib/format/clock.ts';

describe('subscribeToMinutes', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shares one minute timer between listeners and notifies each of them', () => {
    const first = mock(() => undefined);
    const second = mock(() => undefined);
    const stopFirst = subscribeToMinutes(first);
    const stopSecond = subscribeToMinutes(second);
    jest.advanceTimersByTime(59_999);
    expect(first).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    stopFirst();
    stopSecond();
  });

  it('keeps ticking while a listener remains and stops after the last one leaves', () => {
    const first = mock(() => undefined);
    const second = mock(() => undefined);
    const stopFirst = subscribeToMinutes(first);
    const stopSecond = subscribeToMinutes(second);
    stopFirst();
    jest.advanceTimersByTime(60_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    stopSecond();
    jest.advanceTimersByTime(120_000);
    expect(second).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('starts a fresh timer for a listener that arrives after the clock stopped', () => {
    subscribeToMinutes(() => undefined)();
    const listener = mock(() => undefined);
    const stop = subscribeToMinutes(listener);
    jest.advanceTimersByTime(60_000);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('ticks the second clock once a second, on its own timer', () => {
    const minutes = mock(() => undefined);
    const seconds = mock(() => undefined);
    const stopMinutes = subscribeToMinutes(minutes);
    const stopSeconds = subscribeToSeconds(seconds);
    jest.advanceTimersByTime(3000);
    expect(seconds).toHaveBeenCalledTimes(3);
    expect(minutes).not.toHaveBeenCalled();
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
