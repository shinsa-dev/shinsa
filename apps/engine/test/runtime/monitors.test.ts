import { afterEach, describe, expect, test } from 'bun:test';
import { createState, DomainError, type Monitor, type ShinsaState } from '@shinsa/core';
import { Duration, Layer } from 'effect';
import { MAX_CLOCK_DELAY } from '../../src/runtime/clock/schema.ts';
import { EngineStopped } from '../../src/runtime/engine/schema.ts';
import { MonitorClock } from '../../src/runtime/index.ts';
import { MonitorClockTimings } from '../../src/runtime/monitors/schema.ts';
import { captureLogs } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';
import { createFakeEngineCore, openClock } from './harness.ts';

const open: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

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
  let failNext = false;
  let refuseAll = false;
  let applyFires = false;
  let answerNothing = false;
  const fake = createFakeEngineCore(state, (command) => {
    if (failNext) {
      failNext = false;
      return new EngineStopped({ message: 'log full' });
    }
    if (refuseAll) return new DomainError({ code: 'monitor_stale', message: 'That check is not due.' });
    const task = command.type === 'monitor.fire' ? state.tasks[command.taskId] : undefined;
    if (task?.monitor && applyFires) task.monitor = { ...task.monitor, status: 'fired' };
    if (answerNothing || command.type !== 'monitor.fire') return [];
    return [{ ...command, type: 'monitor.fired' }];
  });
  return {
    ...fake,
    state,
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
  };
}

async function openMonitors(fake: ReturnType<typeof createFakeEngine>, now: number, minDelayMs?: number) {
  const timings =
    minDelayMs === undefined
      ? Layer.empty
      : Layer.succeed(MonitorClockTimings, {
          minDelay: Duration.millis(minDelayMs),
          maxDelay: MAX_CLOCK_DELAY,
        });
  const clock = await openClock(MonitorClock, MonitorClock.layer.pipe(Layer.provide(timings)), fake.core, {
    now,
  });
  open.push(clock);
  return clock;
}

describe('the monitor clock', () => {
  test('fires each due monitor once with the next attempt, keyed so a repeat is the same command', async () => {
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
    const clock = await openMonitors(fake, 5_000);
    await clock.fireDue();
    expect(fake.sent).toEqual([
      {
        command: { type: 'monitor.fire', taskId: 'task-1', monitorId: 'm-1', attempt: 2 },
        id: 'monitor:m-1:2',
      },
    ]);
    await clock.setTime(9_500);
    await clock.fireDue();
    expect(fake.sent.map((entry) => entry.id)).toEqual(['monitor:m-1:2', 'monitor:m-1:2', 'monitor:m-2:1']);
  });

  test('a monitor past its timeout is due even before its next check', async () => {
    const fake = createFakeEngine((state) => {
      state.tasks['task-1'] = createTask({
        monitor: createMonitor({ nextCheckAt: 50_000, timeoutAt: 2_000 }),
      });
    });
    await (await openMonitors(fake, 3_000)).fireDue();
    expect(fake.sent).toHaveLength(1);
  });

  test('it schedules for the earliest due monitor, reschedules on changes, and stops cleanly', async () => {
    const fake = createFakeEngine((state) => {
      state.tasks['task-1'] = createTask({ monitor: createMonitor({ nextCheckAt: 0, timeoutAt: 60_000 }) });
    });
    fake.applyFires();
    const clock = await openMonitors(fake, 0, 0);
    await clock.start();
    await clock.start();
    expect(fake.listeners.size).toBe(1);
    await clock.adjust(1);
    expect(fake.sent).toHaveLength(1);
    fake.state.tasks['task-1'] = createTask({ monitor: createMonitor({ nextCheckAt: 5_000 }) });
    fake.notify();
    await clock.stop();
    await clock.stop();
    await clock.adjust(10_000);
    expect(fake.sent).toHaveLength(1);
    await clock.close();
    expect(fake.listeners.size).toBe(0);
  });

  test('a fire the engine refuses is not sent again while the monitor stays the same', async () => {
    const fake = createFakeEngine((state) => {
      state.tasks['task-1'] = createTask({ monitor: createMonitor({ nextCheckAt: 0 }) });
    });
    fake.refuse();
    const clock = await openMonitors(fake, 5_000);
    await clock.fireDue();
    await clock.fireDue();
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
    const clock = await openMonitors(fake, 5_000);
    await clock.fireDue();
    await clock.fireDue();
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
    const logs = captureLogs();
    try {
      const clock = await openMonitors(fake, 0, 5);
      await clock.start();
      await clock.adjust(5);
      expect(fake.sent).toHaveLength(1);
      await clock.adjust(5);
      expect(fake.sent).toHaveLength(2);
      expect(logs.fieldsOf('[Monitors] Could not wake a waiting task')).toEqual([{ error: 'log full' }]);
    } finally {
      logs.restore();
    }
    expect(fake.state.tasks['task-1']?.monitor?.status).toBe('fired');
  });
});
