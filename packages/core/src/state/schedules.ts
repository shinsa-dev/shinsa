import { SCHEDULE_LIMITS, type Schedule } from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import { removeEntry, writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';
import { record } from './write.ts';

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
  writeEntry(state, 'schedules', event.scheduleId, {
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
  });
}

export function describeSchedule(state: ShinsaState, scheduleId: string) {
  const name = state.schedules[scheduleId]?.name;
  return name ? `the schedule “${name}”` : 'a schedule';
}

function describeStarted(state: ShinsaState, event: EventOf<'task.created'>, scheduleId: string) {
  const schedule = describeSchedule(state, scheduleId);
  if (!event.sourceReport) return `Started by ${schedule}`;
  const author = event.sourceReport.author ? ` by ${event.sourceReport.author}` : '';
  return `Filed by ${schedule} from a report${author} in ${event.sourceReport.server}`;
}

function recordFiled(state: ShinsaState, event: EventOf<'task.created'>, title: string) {
  const creator = event.createdBy;
  if (creator?.kind !== 'intake') return;
  record(state, creator.taskId, event.at, {
    actor: 'agent',
    kind: 'delegation',
    text: `Filed a task from a report: ${title}`,
    detail: event.sourceReport?.link ?? event.sourceReport?.reportId ?? null,
    runId: creator.runId,
  });
}

export function applyScheduledTask(state: ShinsaState, event: EventOf<'task.created'>) {
  const task = state.tasks[event.taskId];
  const scheduleId = event.scheduleId;
  if (!task || !scheduleId) return;
  const text = describeStarted(state, event, scheduleId);
  writeEntry(state, 'tasks', event.taskId, {
    ...task,
    scheduleId,
    ...(event.sourceReport ? { sourceReport: event.sourceReport } : {}),
    activity: task.activity.map((entry, index) =>
      index === 0 ? { ...entry, actor: 'shinsa', text } : entry
    ),
  });
  recordFiled(state, event, task.title);
}

export function applyScheduleEvent(state: ShinsaState, event: ScheduleEvent) {
  switch (event.type) {
    case 'schedule.written':
      writeEntry(state, 'schedules', event.schedule.id, event.schedule);
      return;
    case 'schedule.removed':
      removeEntry(state, 'schedules', event.scheduleId);
      return;
    case 'schedule.fired':
      applyFired(state, event);
      return;
  }
}

export function listSchedules(state: ShinsaState): Schedule[] {
  return Object.values(state.schedules).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
