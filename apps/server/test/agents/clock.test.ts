import { describe, expect, test } from 'bun:test';
import { RunClock } from '../../src/agents/clock.ts';

function createTimers() {
  const pending = new Map<number, { fire: () => void; at: number }>();
  let next = 0;
  const timers = {
    at: 0,
    now: () => timers.at,
    start: (fire: () => void, ms: number) => {
      next += 1;
      pending.set(next, { fire, at: timers.at + ms });
      return next;
    },
    clear: (timer: unknown) => {
      pending.delete(timer as number);
    },
    advance: (ms: number) => {
      timers.at += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at > timers.at) continue;
        pending.delete(id);
        timer.fire();
      }
    },
  };
  return timers;
}

function createClock(limitMs: number) {
  const timers = createTimers();
  const state = { expired: false };
  const clock = new RunClock(
    limitMs,
    () => {
      state.expired = true;
    },
    timers
  );
  return { clock, timers, state };
}

describe('RunClock', () => {
  test('expires when the limit passes, not before', () => {
    const { clock, timers, state } = createClock(10);
    clock.start();
    timers.advance(9);
    expect(state.expired).toBe(false);
    timers.advance(1);
    expect(state.expired).toBe(true);
  });

  test('time spent paused does not count, and overlapping pauses resume only once all end', () => {
    const { clock, timers, state } = createClock(40);
    clock.start();
    timers.advance(10);
    clock.pause();
    clock.pause();
    timers.advance(60);
    clock.resume();
    timers.advance(60);
    expect(state.expired).toBe(false);
    clock.resume();
    clock.resume();
    timers.advance(29);
    expect(state.expired).toBe(false);
    timers.advance(1);
    expect(state.expired).toBe(true);
  });

  test('a stopped clock never fires, even when resumed', () => {
    const { clock, timers, state } = createClock(10);
    clock.start();
    clock.pause();
    clock.stop();
    clock.resume();
    clock.stop();
    timers.advance(60);
    expect(state.expired).toBe(false);
  });

  test('stopping a running clock cancels its timer', () => {
    const { clock, timers, state } = createClock(10);
    clock.start();
    clock.stop();
    timers.advance(60);
    expect(state.expired).toBe(false);
  });

  test('without timers of its own it runs on the system clock', async () => {
    const expired = Promise.withResolvers<void>();
    new RunClock(0, () => expired.resolve()).start();
    await expired.promise;
  });
});
