import { afterEach, describe, expect, test } from 'bun:test';
import { createState, DomainError, type Watchdog } from '@shinsa/core';
import { EngineStopped } from '../../src/runtime/engine/schema.ts';
import { WatchdogClock } from '../../src/runtime/index.ts';
import { createTask } from '../helpers/state.ts';
import { createFakeEngineCore, openClock } from './harness.ts';

const open: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

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

function createFakeEngine(watchdogs: Watchdog[], answer: 'events' | 'nothing' | 'failure' | 'refusal') {
  const state = createState();
  state.tasks['task-1'] = createTask({ watchdogs });
  return createFakeEngineCore(state, (command) => {
    if (answer === 'failure') return new EngineStopped({ message: 'log full' });
    if (answer === 'refusal')
      return new DomainError({ code: 'watchdog_stale', message: 'That check is not due.' });
    return answer === 'events' ? [{ ...command, type: 'watchdog.checking' }] : [];
  });
}

async function openWatchdogs(fake: ReturnType<typeof createFakeEngine>) {
  const clock = await openClock(WatchdogClock, WatchdogClock.layer, fake.core, { now: 5_000 });
  open.push(clock);
  return clock;
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
    await (await openWatchdogs(fake)).fireDue();
    expect(fake.sent).toEqual([
      {
        command: { type: 'watchdog.fire', taskId: 'task-1', watchdogId: 'w-1', dueAt: 1_000 },
        id: 'watchdog:w-1:1000',
      },
    ]);
  });

  test('a fire answered with no events is not sent again until the watchdog changes', async () => {
    const fake = createFakeEngine([createWatchdog()], 'nothing');
    const clock = await openWatchdogs(fake);
    await clock.fireDue();
    await clock.fireDue();
    expect(fake.sent).toHaveLength(1);
  });

  test('a fire that fails is tried again, and one core refuses is not', async () => {
    const failing = createFakeEngine([createWatchdog()], 'failure');
    const retried = await openWatchdogs(failing);
    await retried.fireDue();
    await retried.fireDue();
    expect(failing.sent).toHaveLength(2);
    const refusing = createFakeEngine([createWatchdog()], 'refusal');
    const refused = await openWatchdogs(refusing);
    await refused.fireDue();
    await refused.fireDue();
    expect(refusing.sent).toHaveLength(1);
  });
});
