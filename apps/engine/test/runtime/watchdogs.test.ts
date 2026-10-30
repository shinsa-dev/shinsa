import { describe, expect, test } from 'bun:test';
import { createState, type ShinsaCommand, type Watchdog } from '@shinsa/core';
import type { Engine } from '../../src/runtime/engine.ts';
import { WatchdogClock } from '../../src/runtime/index.ts';
import { createTask } from '../helpers/state.ts';

function createWatchdog(overrides: Partial<Watchdog> = {}): Watchdog {
  return {
    id: 'w-1',
    round: 1,
    title: 'Checkout latency',
    check: 'p95 under 400 ms.',
    source: { server: 'maple', data: 'Traces' },
    sourceRequest: null,
    firstCheckMinutes: 360,
    maxGapMinutes: 360,
    forMinutes: 2_880,
    startsOn: 'merge',
    productionCheck: null,
    status: 'watching',
    armedAt: 0,
    awaitingSince: null,
    startedAt: 0,
    endsAt: 100_000,
    nextCheckAt: 1_000,
    runId: null,
    checks: [],
    forkTaskIds: [],
    linkedTaskIds: [],
    endedAt: null,
    ...overrides,
  };
}

function createFakeEngine(watchdogs: Watchdog[], answer: 'events' | 'nothing') {
  const state = createState();
  state.tasks['task-1'] = createTask({ watchdogs });
  const sent: { command: ShinsaCommand; id: string | undefined }[] = [];
  const engine = {
    state,
    subscribe: () => () => undefined,
    dispatch: (command: ShinsaCommand, options: { id?: string } = {}) => {
      sent.push({ command, id: options.id });
      return Promise.resolve(answer === 'events' ? [{ ...command, type: 'watchdog.checking' }] : []);
    },
  };
  return { engine: engine as unknown as Engine, sent };
}

describe('the watchdog clock', () => {
  test('fires each watching watchdog that is due and not checking, keyed by its slot', async () => {
    const fake = createFakeEngine(
      [
        createWatchdog(),
        createWatchdog({ id: 'w-2', nextCheckAt: 9_000 }),
        createWatchdog({ id: 'w-3', runId: 'run-1' }),
        createWatchdog({ id: 'w-4', status: 'needs_source', nextCheckAt: null }),
        createWatchdog({ id: 'w-5', status: 'passed' }),
      ],
      'events'
    );
    await new WatchdogClock(fake.engine, { now: () => 5_000 }).fireDue();
    expect(fake.sent).toEqual([
      {
        command: { type: 'watchdog.fire', taskId: 'task-1', watchdogId: 'w-1', dueAt: 1_000 },
        id: 'watchdog:w-1:1000',
      },
    ]);
  });

  test('a fire answered with no events is not sent again until the watchdog changes', async () => {
    const fake = createFakeEngine([createWatchdog()], 'nothing');
    const clock = new WatchdogClock(fake.engine, { now: () => 5_000 });
    await clock.fireDue();
    await clock.fireDue();
    expect(fake.sent).toHaveLength(1);
  });
});
