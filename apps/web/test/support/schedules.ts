import type { Schedule, WatchSuggestion } from '@shinsa/core';
import { NOW } from './state.ts';

export function createSchedule(overrides: Partial<Schedule> & { id: string }): Schedule {
  return {
    name: `Schedule ${overrides.id}`,
    text: 'Check the build.',
    trigger: { kind: 'interval', everyMinutes: 60 },
    target: { kind: 'new_task', repoId: null, priority: 'normal', mode: 'build' },
    source: null,
    timeZone: 'UTC',
    enabled: true,
    nextRunAt: NOW + 60 * 60_000,
    runCount: 0,
    maxRuns: null,
    runs: [],
    createdAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    createdBy: { kind: 'you' },
    lastTaskId: null,
    lastRunId: null,
    lastReadAt: null,
    stopped: null,
    replayKeys: {},
    ...overrides,
  };
}

export function createWatchSuggestion(overrides: Partial<WatchSuggestion> & { id: string }): WatchSuggestion {
  return {
    projectId: 'p1',
    server: 'slack',
    name: 'Bugs in #feedback',
    text: 'File a task for each new bug in #feedback.',
    trigger: { kind: 'interval', everyMinutes: 60 },
    timeZone: 'UTC',
    maxRuns: null,
    origin: { kind: 'source' },
    status: 'open',
    scheduleId: null,
    createdAt: NOW - 60_000,
    decidedAt: null,
    ...overrides,
  };
}
