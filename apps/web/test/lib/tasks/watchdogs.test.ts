import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { HOUR_MS, type Watchdog } from '@shinsa/core';
import {
  connectWatchdog,
  describeWatchdogProgress,
  describeWatchdogSchedule,
  describeWatchSource,
  forkTask,
  isWatchedTask,
  removeWatchSource,
  resolveWatchingReason,
  stopWatchdog,
  WATCHDOG_STATUS,
} from '@/lib/tasks/watchdogs.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createRepo, createShinsaState, createTask, NOW } from '../../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

function createWatchdog(overrides: Partial<Watchdog> = {}): Watchdog {
  return {
    id: 'w',
    round: 1,
    title: 'Checkout latency',
    check: 'p95 under 400 ms.',
    source: { server: 'maple', data: 'Traces' },
    sourceRequest: null,
    everyMinutes: 360,
    forMinutes: 2_880,
    status: 'watching',
    armedAt: NOW,
    startedAt: NOW,
    endsAt: NOW + 31 * HOUR_MS,
    nextCheckAt: NOW + 6 * HOUR_MS,
    runId: null,
    checks: [{ at: NOW, healthy: true, summary: 'Fine.' }],
    forkTaskId: null,
    endedAt: null,
    ...overrides,
  };
}

describe('describing a watchdog', () => {
  it('says how often it checks and where it stands in each status', () => {
    const fork = createTask({ id: 'f', handle: 'SW-9' });
    const state = createShinsaState({ tasks: [fork] });
    expect(describeWatchdogSchedule(createWatchdog())).toBe('Every 6 h for 48 h');
    expect(describeWatchdogProgress(state, createWatchdog(), NOW)).toBe('31 h left · 1 check');
    expect(describeWatchdogProgress(state, createWatchdog({ runId: 'r' }), NOW)).toBe(
      'Checking now · 1 check so far'
    );
    expect(describeWatchdogProgress(state, createWatchdog({ endsAt: null }), NOW)).toBe('1 h left · 1 check');
    expect(describeWatchdogProgress(state, createWatchdog({ status: 'needs_source' }), NOW)).toBe(
      'Starts once you connect a data source.'
    );
    expect(describeWatchdogProgress(state, createWatchdog({ status: 'passed', checks: [] }), NOW)).toBe(
      'Passed after 0 checks, nothing wrong.'
    );
    expect(describeWatchdogProgress(state, createWatchdog({ status: 'tripped', forkTaskId: 'f' }), NOW)).toBe(
      'Filed SW-9 to fix it.'
    );
    expect(describeWatchdogProgress(state, createWatchdog({ status: 'tripped' }), NOW)).toBe(
      'Found an issue.'
    );
    expect(describeWatchdogProgress(state, createWatchdog({ status: 'stopped' }), NOW)).toBe(
      'Stopped after 1 check.'
    );
    expect(WATCHDOG_STATUS.tripped).toEqual({ label: 'Found an issue', tone: 'red' });
  });

  it('a merged task with an active watchdog is watched, with how long is left', () => {
    const watched = createTask({ id: 't', stage: 'merged', watchdogs: [createWatchdog()] });
    expect(isWatchedTask(watched)).toBe(true);
    expect(resolveWatchingReason(watched, NOW)).toBe('1 watchdog · 31 h left');
    const waiting = createTask({
      id: 't',
      stage: 'merged',
      watchdogs: [createWatchdog({ status: 'needs_source', endsAt: null })],
    });
    expect(resolveWatchingReason(waiting, NOW)).toBe('1 watchdog · waiting for a data source');
    const closed = createTask({ id: 't', stage: 'done', closedAt: NOW, watchdogs: [createWatchdog()] });
    expect(isWatchedTask(closed)).toBe(false);
    expect(resolveWatchingReason(closed, NOW)).toBeNull();
    expect(resolveWatchingReason(createTask({ id: 't', stage: 'merged' }), NOW)).toBeNull();
  });

  it('describes a project’s data source with the repositories it covers', () => {
    const state = createShinsaState({ repos: [createRepo({ id: 'r1', name: 'paywall-next' })] });
    const source = {
      server: 'maple',
      data: 'Traces',
      repoIds: ['r1', 'gone'],
      addedBy: 'agent' as const,
      addedAt: 0,
    };
    expect(describeWatchSource(state, source)).toBe('Traces · paywall-next, gone, added by an agent');
    expect(describeWatchSource(state, { ...source, repoIds: [], addedBy: 'you' })).toBe(
      'Traces · every repository'
    );
  });
});

describe('watchdog actions', () => {
  it('stops and connects a watchdog, removes a source and forks a task into its project', async () => {
    const task = createTask({ id: 't', handle: 'SW-2', repoId: 'r1', projectId: null });
    const state = createShinsaState({ tasks: [task], repos: [createRepo({ id: 'r1', projectId: 'p' })] });
    const watchdog = createWatchdog();
    await stopWatchdog(task, watchdog);
    await connectWatchdog(task, watchdog, ' posthog ', 'Events');
    await removeWatchSource('p', 'maple');
    await forkTask(state, task, 'Fix it in Safari');
    await forkTask(createShinsaState({}), { ...task, repoId: null, projectId: 'own' }, 'Again');
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'watchdog.stop', taskId: 't', watchdogId: 'w' }, 'Stopped the watchdog “Checkout latency”.'],
      [
        { type: 'watchdog.connect', taskId: 't', watchdogId: 'w', server: ' posthog ', data: 'Events' },
        'Connected posthog. The watchdog starts watching.',
      ],
      [
        { type: 'watch_source.remove', projectId: 'p', server: 'maple' },
        'Removed maple from the data sources.',
      ],
      [
        { type: 'task.create', request: 'Fix it in Safari', repoId: 'r1', projectId: 'p', forkOf: 't' },
        'Forked SW-2 into a new task.',
      ],
      [
        { type: 'task.create', request: 'Again', repoId: null, projectId: 'own', forkOf: 't' },
        'Forked SW-2 into a new task.',
      ],
    ] as never);
  });
});
