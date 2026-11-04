import { afterEach, describe, expect, test } from 'bun:test';
import { createState, type Monitor } from '@shinsa/core';
import { Duration, Layer } from 'effect';
import { MAX_CLOCK_DELAY } from '../../src/runtime/clock/schema.ts';
import { MonitorClock } from '../../src/runtime/index.ts';
import { MonitorClockTimings } from '../../src/runtime/monitors/schema.ts';
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
    nextCheckAt: 60_000,
    timeoutAt: 600_000,
    attempts: 0,
    maxAttempts: 3,
    status: 'armed',
    ...overrides,
  };
}

async function startClock(timings: { minDelayMs?: number; maxDelayMs?: number } = {}) {
  const state = createState();
  state.tasks['task-1'] = createTask({ monitor: createMonitor() });
  const fake = createFakeEngineCore(state, (command) => [command]);
  const layer = MonitorClock.layer.pipe(
    Layer.provide(
      Layer.succeed(MonitorClockTimings, {
        minDelay: Duration.millis(timings.minDelayMs ?? 1_000),
        maxDelay: timings.maxDelayMs === undefined ? MAX_CLOCK_DELAY : Duration.millis(timings.maxDelayMs),
      })
    )
  );
  const clock = await openClock(MonitorClock, layer, fake.core, { now: 0 });
  open.push(clock);
  await clock.start();
  return { ...fake, state, clock };
}

describe('the state clock', () => {
  test('a change that keeps the earliest due time keeps the timer it armed', async () => {
    const { state, notify, sent, clock } = await startClock({ minDelayMs: 10_000 });
    state.tasks['task-1'] = createTask({ monitor: createMonitor({ nextCheckAt: 5_000 }) });
    notify();
    await clock.adjust(8_000);
    notify();
    await clock.adjust(2_000);
    expect(sent.map((entry) => entry.id)).toEqual(['monitor:m-1:1']);
  });

  test('a change to the earliest due time re-arms the timer, and nothing due clears it', async () => {
    const { state, notify, sent, clock } = await startClock();
    state.tasks['task-1'] = createTask({ monitor: createMonitor({ nextCheckAt: 30_000 }) });
    notify();
    await clock.adjust(30_000);
    expect(sent).toHaveLength(1);
    state.tasks['task-1'] = createTask({ monitor: null });
    notify();
    state.tasks['task-1'] = createTask({ monitor: createMonitor({ id: 'm-2', nextCheckAt: 40_000 }) });
    await clock.adjust(60_000);
    expect(sent).toHaveLength(1);
  });

  test('a wait longer than its longest delay is cut to it', async () => {
    const { state, sent, clock } = await startClock({ maxDelayMs: 5_000 });
    state.tasks['task-1'] = createTask({ monitor: createMonitor({ nextCheckAt: 3_000 }) });
    await clock.adjust(4_999);
    expect(sent).toHaveLength(0);
    await clock.adjust(1);
    expect(sent.map((entry) => entry.id)).toEqual(['monitor:m-1:1']);
  });
});
