import { describe, expect, test } from 'bun:test';
import {
  applyEvent,
  createState,
  listSchedules,
  type Schedule,
  type ShinsaEventInput,
} from '../../src/index.ts';

function apply(events: ShinsaEventInput[]) {
  let state = createState();
  for (const [index, event] of events.entries())
    state = applyEvent(state, { ...event, seq: index + 1, at: 1_000 });
  return state;
}

function schedule(id: string, createdAt: number): Schedule {
  return {
    id,
    name: id,
    text: 'Go',
    trigger: { kind: 'interval', everyMinutes: 5 },
    target: { kind: 'task', taskId: 't' },
    source: null,
    timeZone: 'UTC',
    enabled: true,
    nextRunAt: null,
    runCount: 0,
    maxRuns: null,
    runs: [],
    createdAt,
    updatedAt: createdAt,
    createdBy: { kind: 'you' },
    lastTaskId: null,
    lastRunId: null,
    lastReadAt: null,
    stopped: null,
    replayKeys: {},
  };
}

describe('schedule events', () => {
  test('a fire, a finished read or a compaction for something that is gone changes nothing', () => {
    const state = apply([
      {
        type: 'schedule.fired',
        scheduleId: 'nope',
        run: { at: 0, outcome: 'sent', taskId: null, deliveryId: null, detail: null },
        nextRunAt: null,
        runCount: 1,
        lastTaskId: null,
        lastRunId: null,
        stopped: null,
        replayKey: null,
      },
      { type: 'schedule.read', scheduleId: 'nope', readFrom: 0 },
      { type: 'run.compacted', runId: 'nope', sessionId: 's' },
    ]);
    expect(state).toEqual({ ...createState(), seq: 3 });
  });

  test('a task or message from a schedule that was removed since still says where it came from', () => {
    const state = apply([
      {
        type: 'task.created',
        taskId: 't',
        request: 'Audit',
        repoId: null,
        priority: 'normal',
        planFirst: false,
        origin: null,
        auto: { shape: true, start: true, priority: true },
        scheduleId: 'gone',
      },
      { type: 'task.messaged', taskId: 't', text: 'Again', scheduleId: 'gone' },
    ]);
    expect(state.tasks.t?.activity.map((entry) => [entry.actor, entry.text])).toEqual([
      ['shinsa', 'Started by a schedule'],
      ['shinsa', 'Sent instructions from a schedule'],
    ]);
    expect(state.tasks.t?.scheduleId).toBe('gone');
  });

  test('lists schedules oldest first', () => {
    const state = apply([
      { type: 'schedule.written', schedule: schedule('b', 2) },
      { type: 'schedule.written', schedule: schedule('a', 2) },
      { type: 'schedule.written', schedule: schedule('c', 1) },
    ]);
    expect(listSchedules(state).map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
  });
});
