import { describeList } from '../chat/text.ts';
import { WATCHDOG_LIMITS, type Watchdog } from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import { writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

type WatchdogEvent = Extract<
  ShinsaEvent,
  {
    type:
      | 'watchdog.armed'
      | 'watchdog.started'
      | 'watchdog.live'
      | 'watchdog.checking'
      | 'watchdog.deferred'
      | 'watchdog.missed'
      | 'watchdog.checked'
      | 'watchdog.report_linked'
      | 'watchdog.ended'
      | 'watch_source.written'
      | 'watch_source.removed';
  }
>;

function updateWatchdog(
  state: ShinsaState,
  event: { taskId: string; watchdogId: string; at: number },
  patch: (watchdog: Watchdog) => Partial<Watchdog>
) {
  const task = state.tasks[event.taskId];
  if (!task) return null;
  const current = (task.watchdogs ?? []).find((watchdog) => watchdog.id === event.watchdogId);
  if (!current) return null;
  const next = { ...current, ...patch(current) };
  updateTask(state, task.id, event.at, {
    watchdogs: (task.watchdogs ?? []).map((watchdog) => (watchdog.id === current.id ? next : watchdog)),
  });
  return next;
}

function describeArmed(watchdog: Watchdog) {
  if (watchdog.status === 'needs_source') return `The watchdog “${watchdog.title}” waits for a data source`;
  if (watchdog.status === 'awaiting_production') {
    return `The watchdog “${watchdog.title}” waits for the change to reach production`;
  }
  return `Started the watchdog “${watchdog.title}”`;
}

function applyArmed(state: ShinsaState, event: EventOf<'watchdog.armed'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  updateTask(state, task.id, event.at, { watchdogs: [...(task.watchdogs ?? []), event.watchdog] });
  record(state, task.id, event.at, {
    actor: 'shinsa',
    kind: 'watchdog',
    text: describeArmed(event.watchdog),
    detail: event.watchdog.check,
  });
}

function listTaskNames(state: ShinsaState, taskIds: readonly string[]) {
  return taskIds.flatMap((id) => {
    const task = state.tasks[id];
    return task ? [task.handle ?? task.title] : [];
  });
}

function describeFound(state: ShinsaState, watchdog: Watchdog) {
  const filed = listTaskNames(state, watchdog.forkTaskIds);
  const linked = listTaskNames(state, watchdog.linkedTaskIds);
  const filedText = filed.length > 0 ? ` and filed ${describeList(filed)}` : '';
  if (linked.length === 0) return filedText;
  const joint = filed.length > 0 ? ', with' : ', already filed as';
  const already = filed.length > 0 ? ' already filed' : '';
  return `${filedText}${joint} ${describeList(linked)}${already}`;
}

function applyChecked(state: ShinsaState, event: EventOf<'watchdog.checked'>) {
  const next = updateWatchdog(state, event, (watchdog) => ({
    status: event.status,
    nextCheckAt: event.nextCheckAt,
    runId: null,
    checks: [...watchdog.checks, event.check].slice(-WATCHDOG_LIMITS.checksKept),
    forkTaskIds: event.forkTaskIds,
    endedAt: event.status === 'watching' ? null : event.at,
  }));
  if (!next) return;
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'watchdog',
    text: event.check.healthy
      ? `The watchdog “${next.title}” found nothing wrong`
      : `The watchdog “${next.title}” found an issue${describeFound(state, next)}`,
    detail: event.check.summary,
  });
}

function applyReportLinked(state: ShinsaState, event: EventOf<'watchdog.report_linked'>) {
  const next = updateWatchdog(state, event, (watchdog) => ({
    linkedTaskIds: [...new Set([...watchdog.linkedTaskIds, event.reportTaskId])],
  }));
  const report = state.tasks[event.reportTaskId];
  if (!next || !report) return;
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'watchdog',
    text: `The watchdog “${next.title}” found a report already filed as ${report.handle ?? report.title}`,
  });
}

function applyMissed(state: ShinsaState, event: EventOf<'watchdog.missed'>) {
  const ended = event.nextCheckAt === null;
  const next = updateWatchdog(state, event, () => ({
    runId: null,
    nextCheckAt: event.nextCheckAt,
    ...(ended ? { status: 'stopped' as const, endedAt: event.at } : {}),
  }));
  if (!next) return;
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'watchdog',
    text: ended
      ? `Could not check the watchdog “${next.title}”, and its window has ended, so it stopped`
      : `Could not check the watchdog “${next.title}”; it tries again at its next check`,
    detail: event.reason,
  });
}

function applyEnded(state: ShinsaState, event: EventOf<'watchdog.ended'>) {
  const next = updateWatchdog(state, event, () => ({
    status: 'stopped',
    nextCheckAt: null,
    runId: null,
    endedAt: event.at,
  }));
  if (!next) return;
  record(state, event.taskId, event.at, {
    actor: 'you',
    kind: 'watchdog',
    text: `Stopped the watchdog “${next.title}”`,
  });
}

function applyLive(state: ShinsaState, event: EventOf<'watchdog.live'>) {
  const next = updateWatchdog(state, event, () => ({
    status: 'watching',
    awaitingSince: null,
    startedAt: event.at,
    endsAt: event.endsAt,
    nextCheckAt: event.nextCheckAt,
    runId: null,
  }));
  if (!next) return;
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'watchdog',
    text: `The change is live in production, so the watchdog “${next.title}” started watching`,
  });
}

function applyStarted(state: ShinsaState, event: EventOf<'watchdog.started'>) {
  const next = updateWatchdog(state, event, () => ({
    status: event.status,
    source: event.source,
    awaitingSince: event.awaitingSince,
    startedAt: event.startedAt,
    endsAt: event.endsAt,
    nextCheckAt: event.nextCheckAt,
  }));
  if (!next) return;
  record(state, event.taskId, event.at, {
    actor: 'you',
    kind: 'watchdog',
    text: `Connected ${event.source.server} to the watchdog “${next.title}”`,
  });
}

export function applyWatchdogEvent(state: ShinsaState, event: WatchdogEvent) {
  switch (event.type) {
    case 'watchdog.armed':
      applyArmed(state, event);
      return;
    case 'watchdog.started':
      applyStarted(state, event);
      return;
    case 'watchdog.live':
      applyLive(state, event);
      return;
    case 'watchdog.checking':
      updateWatchdog(state, event, () => ({ runId: event.runId }));
      return;
    case 'watchdog.deferred':
      updateWatchdog(state, event, () => ({ nextCheckAt: event.nextCheckAt, runId: null }));
      return;
    case 'watchdog.missed':
      applyMissed(state, event);
      return;
    case 'watchdog.checked':
      applyChecked(state, event);
      return;
    case 'watchdog.report_linked':
      applyReportLinked(state, event);
      return;
    case 'watchdog.ended':
      applyEnded(state, event);
      return;
    case 'watch_source.written':
    case 'watch_source.removed':
      applySourceEvent(state, event);
      return;
  }
}

function applySourceEvent(
  state: ShinsaState,
  event: EventOf<'watch_source.written'> | EventOf<'watch_source.removed'>
) {
  const project = state.projects[event.projectId];
  if (!project) return;
  const server = event.type === 'watch_source.written' ? event.source.server : event.server;
  const others = (project.watchSources ?? []).filter((source) => source.server !== server);
  const watchSources = event.type === 'watch_source.written' ? [...others, event.source] : others;
  writeEntry(state, 'projects', project.id, { ...project, watchSources });
}
