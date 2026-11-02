import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createState, type Monitor, type ShinsaState } from '@shinsa/core';
import type { Engine } from '../../src/runtime/engine.ts';
import { MonitorClock } from '../../src/runtime/index.ts';
import { createTask } from '../helpers/state.ts';

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

function createMonitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: 'm-1',
    runId: 'run-1',
    role: 'builder',
    phaseIndex: 0,
    notes: 'The deploy.',
    armedAt: 0,
    nextCheckAt: 60_000,
    timeoutAt: 600_000,
    attempts: 0,
    maxAttempts: 3,
    status: 'armed',
    ...overrides,
  };
}

function createFakeEngine() {
  const state: ShinsaState = createState();
  state.tasks['task-1'] = createTask({ monitor: createMonitor() });
  const listeners = new Set<() => void>();
  const engine = {
    state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: () => Promise.resolve([]),
  };
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return { engine: engine as unknown as Engine, state, notify };
}

function spyOnTimers() {
  const timers = spyOn(globalThis, 'setTimeout');
  const clears = spyOn(globalThis, 'clearTimeout');
  spies.push(timers, clears);
  return { delays: () => timers.mock.calls.map(([, delay]) => delay), clears };
}

describe('the state clock', () => {
  test('a change that keeps the earliest due time keeps the timer it armed', () => {
    const fake = createFakeEngine();
    const timers = spyOnTimers();
    const clock = new MonitorClock(fake.engine, { now: () => 0 });
    clock.start();
    fake.notify();
    fake.notify();
    expect(timers.delays()).toEqual([60_000]);
    expect(timers.clears).not.toHaveBeenCalled();
    clock.stop();
    expect(timers.clears).toHaveBeenCalledTimes(1);
  });

  test('a change to the earliest due time re-arms the timer, and nothing due clears it', () => {
    const fake = createFakeEngine();
    const timers = spyOnTimers();
    const clock = new MonitorClock(fake.engine, { now: () => 0 });
    clock.start();
    fake.state.tasks['task-1'] = createTask({ monitor: createMonitor({ nextCheckAt: 30_000 }) });
    fake.notify();
    expect(timers.delays()).toEqual([60_000, 30_000]);
    fake.state.tasks['task-1'] = createTask({ monitor: null });
    fake.notify();
    expect(timers.clears).toHaveBeenCalledTimes(2);
    clock.stop();
  });

  test('a wait longer than its longest delay is cut to it', () => {
    const fake = createFakeEngine();
    const timers = spyOnTimers();
    const clock = new MonitorClock(fake.engine, { now: () => 0, maxDelayMs: 5_000 });
    clock.start();
    expect(timers.delays()).toEqual([5_000]);
    clock.stop();
  });
});
