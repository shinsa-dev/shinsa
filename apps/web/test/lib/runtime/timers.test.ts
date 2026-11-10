import { afterEach, describe, expect, it, jest, spyOn } from 'bun:test';
import { scheduleAfter, scheduleEvery } from '@/lib/runtime/timers.ts';

afterEach(() => {
  jest.useRealTimers();
});

describe('scheduleAfter', () => {
  it('runs once the delay has passed', () => {
    jest.useFakeTimers();
    let runs = 0;
    scheduleAfter(100, () => (runs += 1));
    jest.advanceTimersByTime(99);
    expect(runs).toBe(0);
    jest.advanceTimersByTime(1);
    expect(runs).toBe(1);
    jest.advanceTimersByTime(500);
    expect(runs).toBe(1);
  });

  it('never runs once cancelled', () => {
    jest.useFakeTimers();
    let runs = 0;
    const cancel = scheduleAfter(100, () => (runs += 1));
    jest.advanceTimersByTime(50);
    cancel();
    jest.advanceTimersByTime(500);
    expect(runs).toBe(0);
  });
});

describe('scheduleEvery', () => {
  it('runs every period until cancelled', () => {
    jest.useFakeTimers();
    let runs = 0;
    const cancel = scheduleEvery(100, () => (runs += 1));
    jest.advanceTimersByTime(99);
    expect(runs).toBe(0);
    jest.advanceTimersByTime(201);
    expect(runs).toBe(3);
    cancel();
    jest.advanceTimersByTime(500);
    expect(runs).toBe(3);
  });
});

describe('a run that throws', () => {
  it('is reported like a timer callback and never stops the repeat', () => {
    jest.useFakeTimers();
    const reported = spyOn(globalThis, 'reportError').mockImplementation(() => undefined);
    let runs = 0;
    const cancel = scheduleEvery(100, () => {
      runs += 1;
      if (runs === 2) throw new Error('listener broke');
    });
    jest.advanceTimersByTime(400);
    cancel();
    expect(runs).toBe(4);
    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledWith(new Error('listener broke'));
    reported.mockRestore();
  });

  it('is reported once for a single delay', () => {
    jest.useFakeTimers();
    const reported = spyOn(globalThis, 'reportError').mockImplementation(() => undefined);
    scheduleAfter(100, () => {
      throw new Error('once');
    });
    jest.advanceTimersByTime(100);
    expect(reported).toHaveBeenCalledTimes(1);
    reported.mockRestore();
  });
});
