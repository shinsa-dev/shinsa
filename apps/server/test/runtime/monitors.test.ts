import { describe, expect, test } from 'bun:test';
import { createState, DomainError, type Monitor, type ShinsaCommand, type ShinsaState } from '@shinsa/core';
import type { Engine } from '../../src/runtime/engine.ts';
import { MonitorClock } from '../../src/runtime/index.ts';
import { until } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';

function createMonitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: 'm-1',
    runId: 'run-1',
    role: 'builder',
    phaseIndex: 0,
    notes: 'The deploy.',
    armedAt: 0,
    nextCheckAt: 1_000,
    timeoutAt: 10_000,
    attempts: 0,
    maxAttempts: 3,
    status: 'armed',
    ...overrides,
  };
}

function createFakeEngine(patch: (state: ShinsaState) => void) {
  const state = createState();
  patch(state);
  const listeners = new Set<() => void>();
  const sent: { command: ShinsaCommand; id: string | undefined }[] = [];
  let failNext = false;
  let refuseAll = false;
  let applyFires = false;
  let answerNothing = false;
  const engine = {
    state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (command: ShinsaCommand, options: { id?: string } = {}) => {
      sent.push({ command, id: options.id });
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error('log full'));
      }
      if (refuseAll) return Promise.reject(new DomainError('monitor_stale', 'That check is not due.'));
      const task = command.type === 'monitor.fire' ? state.tasks[command.taskId] : undefined;
      if (task?.monitor && applyFires) task.monitor = { ...task.monitor, status: 'fired' };
      if (answerNothing || command.type !== 'monitor.fire') return Promise.resolve([]);
      return Promise.resolve([{ ...command, type: 'monitor.fired' }]);
    },
  };
  return {
    engine: engine as unknown as Engine,
    state,
    sent,
    notify: () => {
      for (const listener of listeners) listener();
    },
    failOnce: () => {
      failNext = true;
    },
    refuse: () => {
      refuseAll = true;
    },
    answerNothing: () => {
      answerNothing = true;
    },
    update: (change: (state: ShinsaState) => void) => change(state),
    applyFires: () => {
      applyFires = true;
    },
    listeners,
  };
}

describe('the monitor clock', () => {
  test('fires each due monitor once with the next attempt, keyed so a repeat is the same command', async () => {
    let now = 5_000;
    const fake = createFakeEngine((state) => {
      state.tasks['task-1'] = createTask({ monitor: createMonitor({ attempts: 1 }) });
      state.tasks['task-2'] = createTask({
        id: 'task-2',
        monitor: createMonitor({ id: 'm-2', nextCheckAt: 9_000 }),
      });
      state.tasks['task-3'] = createTask({
        id: 'task-3',
        monitor: createMonitor({ id: 'm-3', status: 'fired' }),
      });
      state.tasks['task-4'] = createTask({ id: 'task-4' });
    });
    const clock = new MonitorClock(fake.engine, { now: () => now });
    await clock.fireDue();
    expect(fake.sent).toEqual([
      {
        command: { type: 'monitor.fire', taskId: 'task-1', monitorId: 'm-1', attempt: 2 },
        id: 'monitor:m-1:2',
      },
    ]);
    now = 9_500;
    await clock.fireDue();
    expect(fake.sent.map((entry) => entry.id)).toEqual(['monitor:m-1:2', 'monitor:m-1:2', 'monitor:m-2:1']);
  });

  test('a monitor past its timeout is due even before its next check', async () => {
    const fake = createFakeEngine((state) => {
      state.tasks['task-1'] = createTask({
        monitor: createMonitor({ nextCheckAt: 50_000, timeoutAt: 2_000 }),
      });
    });
    await new MonitorClock(fake.engine, { now: () => 3_000 }).fireDue();
    expect(fake.sent).toHaveLength(1);
  });

  test('it schedules for the earliest due monitor, reschedules on changes, and stops cleanly', async () => {
    const fake = createFakeEngine((state) => {
      state.tasks['task-1'] = createTask({ monitor: createMonitor({ nextCheckAt: 0, timeoutAt: 60_000 }) });
    });
    fake.applyFires();
    const clock = new MonitorClock(fake.engine, { minDelayMs: 0 });
    clock.start();
    clock.start();
    expect(fake.listeners.size).toBe(1);
    fake.notify();
    await until('the fire', () => fake.sent.length === 1);
    fake.state.tasks['task-1'] = createTask({ monitor: null });
    fake.notify();
    clock.stop();
    clock.stop();
    expect(fake.listeners.size).toBe(0);
    fake.notify();
    expect(fake.sent).toHaveLength(1);
  });

  test('a fire the engine refuses is not sent again while the monitor stays the same', async () => {
    const fake = createFakeEngine((state) => {
      state.tasks['task-1'] = createTask({ monitor: createMonitor({ nextCheckAt: 0 }) });
    });
    fake.refuse();
    const clock = new MonitorClock(fake.engine, { now: () => 5_000 });
    clock.start();
    await clock.fireDue();
    await clock.fireDue();
    clock.stop();
    expect(fake.sent.map((entry) => entry.id)).toEqual(['monitor:m-1:1']);
    fake.update((state) => {
      const task = state.tasks['task-1'];
      if (task?.monitor) task.monitor = { ...task.monitor, attempts: 1 };
    });
    await clock.fireDue();
    expect(fake.sent.map((entry) => entry.id)).toEqual(['monitor:m-1:1', 'monitor:m-1:2']);
  });

  test('a fire the engine answers with nothing is not sent again while the monitor stays the same', async () => {
    const fake = createFakeEngine((state) => {
      state.tasks['task-1'] = createTask({ monitor: createMonitor({ nextCheckAt: 0 }) });
    });
    fake.answerNothing();
    const clock = new MonitorClock(fake.engine, { now: () => 5_000 });
    clock.start();
    await clock.fireDue();
    await clock.fireDue();
    clock.stop();
    expect(fake.sent.map((entry) => entry.id)).toEqual(['monitor:m-1:1']);
    fake.update((state) => {
      const task = state.tasks['task-1'];
      if (task?.monitor) task.monitor = { ...task.monitor, attempts: 1 };
    });
    await clock.fireDue();
    expect(fake.sent.map((entry) => entry.id)).toEqual(['monitor:m-1:1', 'monitor:m-1:2']);
  });

  test('a failed fire is logged and tried again on the next tick', async () => {
    const fake = createFakeEngine((state) => {
      state.tasks['task-1'] = createTask({ monitor: createMonitor({ nextCheckAt: 0 }) });
    });
    fake.failOnce();
    fake.applyFires();
    const clock = new MonitorClock(fake.engine, { minDelayMs: 5 });
    clock.start();
    await until('two tries', () => fake.sent.length === 2);
    clock.stop();
    expect(fake.state.tasks['task-1']?.monitor?.status).toBe('fired');
  });
});
