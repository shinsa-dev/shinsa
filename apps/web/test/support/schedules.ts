import type { Schedule } from '@shinsa/core';
import { NOW } from './state.ts';

export function createSchedule(overrides: Partial<Schedule> & { id: string }): Schedule {
  return {
    name: `Schedule ${overrides.id}`,
    text: 'Check the build.',
    trigger: { kind: 'interval', everyMinutes: 60 },
    target: { kind: 'new_task', repoId: null, priority: 'normal', mode: 'build' },
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
    stopped: null,
    replayKeys: {},
    ...overrides,
  };
}
