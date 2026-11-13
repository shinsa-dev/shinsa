import { afterEach, describe, expect, test } from 'bun:test';
import { type AutoRetry, createState, DomainError, type ShinsaState } from '@shinsa/core';
import { Duration, Layer } from 'effect';
import { MAX_CLOCK_DELAY } from '../../src/runtime/clock/schema.ts';
import { EngineStopped } from '../../src/runtime/engine/schema.ts';
import { TaskRetry } from '../../src/tasks/index.ts';
import { resolveRetryCommandId } from '../../src/tasks/retry/command.ts';
import { TaskRetryTimings } from '../../src/tasks/retry/schema.ts';
import { captureLogs } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';
import { createFakeEngineCore, openClock } from '../runtime/harness.ts';

const open: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

function createRetry(overrides: Partial<AutoRetry> = {}): AutoRetry {
  return {
    at: 1_000,
    attempt: 1,
    title: 'Fixing is not making progress',
    detail: 'The failing checks came back after 8 fix rounds.',
    runId: null,
    cause: null,
    milestone: 'plan:1',
    status: 'armed',
    ...overrides,
  };
}

function createFakeEngine(patch: (state: ShinsaState) => void) {
  const state = createState();
  patch(state);
  const reply = { failNext: false, refuse: false, nothing: false, apply: false };
  const fake = createFakeEngineCore(state, (command) => {
    if (reply.failNext) {
      reply.failNext = false;
      return new EngineStopped({ message: 'log full' });
    }
    if (reply.refuse) return new DomainError({ code: 'not_found', message: 'No such task.' });
    if (command.type !== 'task.auto_retry' || reply.nothing) return [];
    const task = state.tasks[command.taskId];
    if (task?.autoRetry && reply.apply) task.autoRetry = null;
    return [{ type: 'task.retry_cleared', taskId: command.taskId, streak: 'kept' }];
  });
  return { ...fake, state, reply };
}

async function openRetries(fake: ReturnType<typeof createFakeEngine>, now: number, minDelayMs?: number) {
  const timings =
    minDelayMs === undefined
      ? Layer.empty
      : Layer.succeed(TaskRetryTimings, { minDelay: Duration.millis(minDelayMs), maxDelay: MAX_CLOCK_DELAY });
  const clock = await openClock(TaskRetry, TaskRetry.layer.pipe(Layer.provide(timings)), fake.core, { now });
  open.push(clock);
  return clock;
}

describe('the task retry clock', () => {
  test('the command id is fixed by the task, the attempt and when it was due', () => {
    expect(resolveRetryCommandId('task-1', { attempt: 3, at: 1_700_000_000_000 })).toBe(
      'auto-retry:task-1:3:1700000000000'
    );
  });

  test('retries each due task once, keyed so a repeat is the same command, and skips the rest', async () => {
    const fake = createFakeEngine((state) => {
      state.tasks['task-1'] = createTask({ autoRetry: createRetry({ attempt: 2 }) });
      state.tasks['task-2'] = createTask({ id: 'task-2', autoRetry: createRetry({ at: 9_000 }) });
      state.tasks['task-3'] = createTask({ id: 'task-3', autoRetry: createRetry({ status: 'spent' }) });
      state.tasks['task-4'] = createTask({ id: 'task-4' });
    });
    const clock = await openRetries(fake, 5_000);
    await clock.fireDue();
    expect(fake.sent).toEqual([
      { command: { type: 'task.auto_retry', taskId: 'task-1' }, id: 'auto-retry:task-1:2:1000' },
    ]);
    await clock.setTime(9_500);
    await clock.fireDue();
    expect(fake.sent.map((entry) => entry.id)).toEqual([
      'auto-retry:task-1:2:1000',
      'auto-retry:task-1:2:1000',
      'auto-retry:task-2:1:9000',
    ]);
  });

  test('a streak that starts again gets a new command id, so the log does not skip it as a repeat', async () => {
    const fake = createFakeEngine((state) => {
      state.tasks['task-1'] = createTask({ autoRetry: createRetry({ at: 1_000 }) });
    });
    const clock = await openRetries(fake, 2_000);
    await clock.fireDue();
    const task = fake.state.tasks['task-1'];
    if (task) task.autoRetry = createRetry({ at: 61_000 });
    await clock.setTime(61_000);
    await clock.fireDue();
    expect(fake.sent.map((entry) => entry.id)).toEqual([
      'auto-retry:task-1:1:1000',
      'auto-retry:task-1:1:61000',
    ]);
  });

  test('it waits for the earliest retry, fires it by itself, and stops cleanly', async () => {
    const fake = createFakeEngine((state) => {
      state.tasks['task-1'] = createTask({ autoRetry: createRetry({ at: 60_000 }) });
    });
    fake.reply.apply = true;
    const clock = await openRetries(fake, 0, 0);
    await clock.start();
    await clock.start();
    expect(fake.listeners.size).toBe(1);
    await clock.adjust(59_999);
    expect(fake.sent).toHaveLength(0);
    await clock.adjust(1);
    expect(fake.sent).toHaveLength(1);
    expect(fake.state.tasks['task-1']?.autoRetry).toBeNull();
    fake.state.tasks['task-1'] = createTask({ autoRetry: createRetry({ at: 120_000, attempt: 2 }) });
    fake.notify();
    await clock.stop();
    await clock.adjust(120_000);
    expect(fake.sent).toHaveLength(1);
    await clock.close();
    expect(fake.listeners.size).toBe(0);
  });

  test('a retry the engine refuses or ignores is not sent again while it stays the same', async () => {
    for (const answer of ['refuse', 'nothing'] as const) {
      const fake = createFakeEngine((state) => {
        state.tasks['task-1'] = createTask({ autoRetry: createRetry() });
      });
      fake.reply[answer] = true;
      const clock = await openRetries(fake, 5_000);
      await clock.fireDue();
      await clock.fireDue();
      expect(fake.sent.map((entry) => entry.id)).toEqual(['auto-retry:task-1:1:1000']);
      const task = fake.state.tasks['task-1'];
      if (task) task.autoRetry = createRetry({ attempt: 2, at: 4_000 });
      await clock.fireDue();
      expect(fake.sent.map((entry) => entry.id)).toEqual([
        'auto-retry:task-1:1:1000',
        'auto-retry:task-1:2:4000',
      ]);
    }
  });

  test('a failed retry is logged and tried again on the next tick', async () => {
    const fake = createFakeEngine((state) => {
      state.tasks['task-1'] = createTask({ autoRetry: createRetry({ at: 0 }) });
    });
    fake.reply.failNext = true;
    fake.reply.apply = true;
    const logs = captureLogs();
    try {
      const clock = await openRetries(fake, 0, 5);
      await clock.start();
      await clock.adjust(5);
      expect(fake.sent).toHaveLength(1);
      await clock.adjust(5);
      expect(fake.sent).toHaveLength(2);
      expect(logs.fieldsOf('[Tasks] Could not retry a task')).toEqual([{ error: 'log full' }]);
    } finally {
      logs.restore();
    }
    expect(fake.state.tasks['task-1']?.autoRetry).toBeNull();
  });
});
