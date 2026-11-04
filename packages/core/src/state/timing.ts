import type { Task, TaskTiming, YourInput } from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import { writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';

const EMPTY_TIMING: TaskTiming = {
  paused: [],
  pausedSince: null,
  needsYou: [],
  needsYouSince: null,
  openGates: [],
  inputs: [],
};

export function resolveTaskTiming(task: Pick<Task, 'timing'>): TaskTiming {
  return task.timing ?? EMPTY_TIMING;
}

export function isTaskPaused(task: Task) {
  return (
    Boolean(task.snoozed) ||
    Boolean(task.backlog) ||
    task.stage === 'waiting_on_tasks' ||
    task.usageWait?.status === 'armed'
  );
}

function writeTiming(state: ShinsaState, task: Task, timing: TaskTiming) {
  writeEntry(state, 'tasks', task.id, { ...task, timing });
}

function syncPaused(state: ShinsaState, taskId: string, at: number) {
  const task = state.tasks[taskId];
  if (!task) return;
  const timing = resolveTaskTiming(task);
  const paused = isTaskPaused(task);
  if (paused && timing.pausedSince === null) {
    writeTiming(state, task, { ...timing, pausedSince: at });
    return;
  }
  if (paused || timing.pausedSince === null) return;
  writeTiming(state, task, {
    ...timing,
    paused: [...timing.paused, { from: timing.pausedSince, to: at }],
    pausedSince: null,
  });
}

function openGate(state: ShinsaState, taskId: string, gateId: string, at: number) {
  const task = state.tasks[taskId];
  if (!task) return;
  const timing = resolveTaskTiming(task);
  if (timing.openGates.includes(gateId)) return;
  writeTiming(state, task, {
    ...timing,
    openGates: [...timing.openGates, gateId],
    needsYouSince: timing.needsYouSince ?? at,
  });
}

function closeGate(state: ShinsaState, gateId: string, answered: boolean, at: number) {
  const taskId = state.gates[gateId]?.taskId;
  const task = taskId ? state.tasks[taskId] : undefined;
  if (!task) return;
  const timing = resolveTaskTiming(task);
  if (!timing.openGates.includes(gateId)) return;
  const openGates = timing.openGates.filter((id) => id !== gateId);
  if (openGates.length > 0 || timing.needsYouSince === null) {
    writeTiming(state, task, { ...timing, openGates });
    return;
  }
  writeTiming(state, task, {
    ...timing,
    openGates,
    needsYou: [...timing.needsYou, { from: timing.needsYouSince, to: at, answered }],
    needsYouSince: null,
  });
}

function isYours(event: ShinsaEvent) {
  return !event.onBehalf && !event.byTask && !event.byGuest;
}

function recordInput(state: ShinsaState, taskId: string, input: YourInput) {
  const task = state.tasks[taskId];
  if (!task) return;
  const timing = resolveTaskTiming(task);
  writeTiming(state, task, { ...timing, inputs: [...timing.inputs, input] });
}

function recordAnswer(state: ShinsaState, event: EventOf<'gate.answered'>) {
  const gate = state.gates[event.gateId];
  if (!gate || event.ahead || !isYours(event)) return;
  recordInput(state, gate.taskId, { at: event.at, kind: 'gate', gate: gate.type, decision: event.decision });
}

function recordMessage(state: ShinsaState, event: EventOf<'task.messaged'>) {
  if (event.scheduleId || event.kept || !isYours(event)) return;
  if (event.kind === 'new_round' || event.kind === 'separate_task') return;
  recordInput(state, event.taskId, { at: event.at, kind: 'message' });
}

export function applyTimingEvent(state: ShinsaState, event: ShinsaEvent) {
  switch (event.type) {
    case 'task.created':
    case 'task.staged':
    case 'task.backlog_changed':
    case 'task.snooze_changed':
    case 'usage_wait.armed':
    case 'usage_wait.ended':
      syncPaused(state, event.taskId, event.at);
      return;
    case 'gate.opened':
      if (event.gate.status === 'open') openGate(state, event.gate.taskId, event.gate.id, event.at);
      return;
    case 'gate.answered':
      recordAnswer(state, event);
      closeGate(state, event.gateId, true, event.at);
      return;
    case 'task.messaged':
      recordMessage(state, event);
      return;
    case 'gate.superseded':
      closeGate(state, event.gateId, true, event.at);
      return;
    case 'gate.withdrawn':
      closeGate(state, event.gateId, false, event.at);
      return;
    default:
      return;
  }
}
