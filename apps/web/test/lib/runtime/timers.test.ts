import { afterEach, describe, expect, it, jest } from 'bun:test';
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
