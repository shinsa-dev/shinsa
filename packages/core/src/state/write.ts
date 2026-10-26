import { type Activity, type Gate, type Run, resolveRoundStamp, type Task } from '../domain/index.ts';
import { writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';

type ActivityEntry = Pick<Activity, 'actor' | 'kind' | 'text'> &
  Partial<
    Pick<Activity, 'detail' | 'evidenceId' | 'runId' | 'gateType' | 'comments' | 'noted' | 'undelivered'>
  >;

const ACTIVITY_LIMIT = 200;

const ON_BEHALF = new WeakMap<ShinsaState, string | null>();

export function applyOnBehalf<T>(state: ShinsaState, byTask: string | null, apply: () => T): T {
  ON_BEHALF.set(state, byTask);
  try {
    return apply();
  } finally {
    ON_BEHALF.delete(state);
  }
}

export function record(state: ShinsaState, taskId: string, at: number, entry: ActivityEntry) {
  const task = state.tasks[taskId];
  if (!task) return;
  const byTask = ON_BEHALF.get(state);
  const onBehalf =
    entry.actor === 'you' && ON_BEHALF.has(state) ? { onBehalf: true, ...(byTask ? { byTask } : {}) } : {};
  const activity = [
    ...task.activity,
    { detail: null, evidenceId: null, ...entry, ...onBehalf, ...resolveRoundStamp(task), at },
  ];
  writeEntry(state, 'tasks', taskId, { ...task, activity: activity.slice(-ACTIVITY_LIMIT) });
}

export function updateTask(state: ShinsaState, taskId: string, at: number, patch: Partial<Task>) {
  const task = state.tasks[taskId];
  if (!task) return;
  writeEntry(state, 'tasks', taskId, { ...task, ...patch, updatedAt: at });
}

export function updateRun(state: ShinsaState, runId: string, patch: Partial<Run>) {
  const run = state.runs[runId];
  if (!run) return;
  writeEntry(state, 'runs', runId, { ...run, ...patch });
}

export function updateGate(state: ShinsaState, gateId: string, patch: Partial<Gate>) {
  const gate = state.gates[gateId];
  if (!gate) return;
  writeEntry(state, 'gates', gateId, { ...gate, ...patch });
}
