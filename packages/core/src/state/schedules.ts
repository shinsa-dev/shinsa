import { SCHEDULE_LIMITS, type Schedule } from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import type { ShinsaState } from './project.ts';

type ScheduleEvent = Extract<
  ShinsaEvent,
  { type: 'schedule.written' | 'schedule.removed' | 'schedule.fired' }
>;

function rememberReplayKey(keys: Record<string, number>, key: string | null, at: number) {
  const live = Object.entries(keys).filter(([, expiresAt]) => expiresAt > at);
  if (key !== null) live.push([key, at + SCHEDULE_LIMITS.replayTtlMs]);
  return Object.fromEntries(live.sort((a, b) => a[1] - b[1]).slice(-SCHEDULE_LIMITS.replayKeys));
}

function applyFired(state: ShinsaState, event: EventOf<'schedule.fired'>) {
  const schedule = state.schedules[event.scheduleId];
  if (!schedule) return;
  state.schedules[event.scheduleId] = {
    ...schedule,
    runs: [...schedule.runs, event.run].slice(-SCHEDULE_LIMITS.runsKept),
    nextRunAt: event.nextRunAt,
    runCount: event.runCount,
    lastTaskId: event.lastTaskId,
    lastRunId: event.lastRunId,
    stopped: event.stopped,
    enabled: event.stopped === null && schedule.enabled,
    replayKeys: rememberReplayKey(schedule.replayKeys, event.replayKey, event.at),
    updatedAt: event.at,
  };
}

export function describeSchedule(state: ShinsaState, scheduleId: string) {
  const name = state.schedules[scheduleId]?.name;
  return name ? `the schedule “${name}”` : 'a schedule';
}

export function applyScheduledTask(state: ShinsaState, event: EventOf<'task.created'>) {
  const task = state.tasks[event.taskId];
  const scheduleId = event.scheduleId;
  if (!task || !scheduleId) return;
  const text = `Started by ${describeSchedule(state, scheduleId)}`;
  state.tasks[event.taskId] = {
    ...task,
    scheduleId,
    activity: task.activity.map((entry, index) =>
      index === 0 ? { ...entry, actor: 'shinsa', text } : entry
    ),
  };
}

export function applyScheduleEvent(state: ShinsaState, event: ScheduleEvent) {
  switch (event.type) {
    case 'schedule.written':
      state.schedules[event.schedule.id] = event.schedule;
      return;
    case 'schedule.removed':
      delete state.schedules[event.scheduleId];
      return;
    case 'schedule.fired':
      applyFired(state, event);
      return;
  }
}

export function listSchedules(state: ShinsaState): Schedule[] {
  return Object.values(state.schedules).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
