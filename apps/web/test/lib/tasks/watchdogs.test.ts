import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { HOUR_MS, type Watchdog } from '@shinsa/core';
import {
  connectWatchdog,
  describeWatchdogMeta,
  describeWatchdogSchedule,
  describeWatchdogSummary,
  describeWatchSource,
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
    firstCheckMinutes: 360,
    maxGapMinutes: 360,
    forMinutes: 2_880,
    startsOn: 'merge',
    productionCheck: null,
    status: 'watching',
    armedAt: NOW,
    awaitingSince: null,
    startedAt: NOW,
    endsAt: NOW + 31 * HOUR_MS,
    nextCheckAt: NOW + 6 * HOUR_MS,
    runId: null,
    checks: [{ at: NOW, healthy: true, summary: 'Fine.' }],
    forkTaskIds: [],
    linkedTaskIds: [],
    endedAt: null,
    ...overrides,
  };
}

describe('describing a watchdog', () => {
  it('says how often it checks and where it stands in each status', () => {
    const fork = createTask({ id: 'f', handle: 'SW-9' });
    const second = createTask({ id: 'g', handle: 'SW-10' });
    const state = createShinsaState({ tasks: [fork, second] });
    expect(describeWatchdogSchedule(createWatchdog())).toBe(
      'First check after 6 h, then up to every 6 h, for 48 h'
    );
    expect(
      describeWatchdogSchedule(
        createWatchdog({
          firstCheckMinutes: 30,
          maxGapMinutes: 360,
          forMinutes: 4_320,
          startsOn: 'production',
        })
      )
    ).toBe('First check after 30 min, then up to every 6 h, for 72 h once live in production');
    const summary = (overrides: Partial<Watchdog>) =>
      describeWatchdogSummary(state, createWatchdog(overrides), NOW);
    expect(summary({ status: 'needs_source' })).toBe('Starts once you connect an integration.');
    expect(summary({ status: 'awaiting_production', checks: [] })).toBe(
      'Starts once the change is live in production.'
    );
    expect(summary({ status: 'awaiting_production' })).toBe(
      'Starts once the change is live in production. Fine.'
    );
    expect(summary({ status: 'awaiting_production', runId: 'r' })).toBe(
      'Checking whether the change is live in production.'
    );
    expect(summary({})).toBe('Fine.');
    expect(summary({ runId: 'r' })).toBe('Checking now.');
    expect(summary({ checks: [], nextCheckAt: NOW + 20 * 60_000 })).toBe('First check in 20 min.');
    expect(summary({ checks: [], nextCheckAt: NOW + 3 * HOUR_MS })).toBe('First check in 3 h.');
    expect(summary({ checks: [], nextCheckAt: null })).toBe('First check in 1 min.');
    expect(summary({ status: 'passed' })).toBe('Held up for 48 h with nothing wrong.');
    expect(
      summary({
        status: 'tripped',
        forkTaskIds: ['f'],
        checks: [{ at: NOW, healthy: false, summary: 'Errors in Safari.' }],
      })
    ).toBe('Errors in Safari. Filed [SW-9](shinsa://task/f) to fix it.');
    expect(
      summary({
        status: 'tripped',
        forkTaskIds: ['f', 'gone', 'g'],
        checks: [{ at: NOW, healthy: false, summary: 'Two errors.' }],
      })
    ).toBe('Two errors. Filed [SW-9](shinsa://task/f) and [SW-10](shinsa://task/g) to fix it.');
    expect(
      summary({
        status: 'tripped',
        linkedTaskIds: ['g'],
        checks: [{ at: NOW, healthy: false, summary: 'Errors in Safari.' }],
      })
    ).toBe('Errors in Safari. Already filed as [SW-10](shinsa://task/g).');
    expect(
      summary({
        status: 'tripped',
        forkTaskIds: ['f'],
        linkedTaskIds: ['g', 'gone'],
        checks: [{ at: NOW, healthy: false, summary: 'Two errors.' }],
      })
    ).toBe('Two errors. Filed [SW-9](shinsa://task/f) to fix it. Already filed as [SW-10](shinsa://task/g).');
    expect(summary({ status: 'tripped', checks: [] })).toBe('Found an issue.');
    expect(summary({ status: 'stopped' })).toBe('Stopped after 1 check.');
    const meta = (overrides: Partial<Watchdog>) => describeWatchdogMeta(createWatchdog(overrides), NOW);
    expect(meta({})).toBe('31 h left · 1 check');
    expect(meta({ endsAt: null })).toBe('1 h left · 1 check');
    expect(meta({ status: 'needs_source' })).toBeNull();
    expect(meta({ status: 'awaiting_production' })).toBeNull();
    expect(meta({ status: 'passed', checks: [] })).toBe('0 checks');
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
    expect(resolveWatchingReason(waiting, NOW)).toBe('1 watchdog · waiting for an integration');
    const released = createTask({
      id: 't',
      stage: 'merged',
      watchdogs: [createWatchdog({ status: 'awaiting_production', endsAt: null })],
    });
    expect(resolveWatchingReason(released, NOW)).toBe('1 watchdog · waiting for production');
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
  it('stops and connects a watchdog and removes a source', async () => {
    const task = createTask({ id: 't', handle: 'SW-2', repoId: 'r1', projectId: null });
    const watchdog = createWatchdog();
    await stopWatchdog(task, watchdog);
    await connectWatchdog(task, watchdog, ' posthog ', 'Events');
    await removeWatchSource('p', 'maple');
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'watchdog.stop', taskId: 't', watchdogId: 'w' }, 'Stopped the watchdog “Checkout latency”.'],
      [
        { type: 'watchdog.connect', taskId: 't', watchdogId: 'w', server: ' posthog ', data: 'Events' },
        'Connected posthog.',
      ],
      [{ type: 'watch_source.remove', projectId: 'p', server: 'maple' }, 'Removed maple from the project.'],
    ] as never);
  });
});
