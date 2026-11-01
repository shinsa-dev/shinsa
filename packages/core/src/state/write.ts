import { type Activity, type Gate, type Run, resolveRoundStamp, type Task } from '../domain/index.ts';
import { writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';

type ActivityEntry = Pick<Activity, 'actor' | 'kind' | 'text'> &
  Partial<
    Pick<Activity, 'detail' | 'evidenceId' | 'runId' | 'gateType' | 'comments' | 'noted' | 'undelivered'>
  >;

const ACTIVITY_LIMIT = 200;

type ActorStamp = Pick<Activity, 'onBehalf' | 'byTask' | 'byGuest'>;

const ACTOR_STAMPS = new WeakMap<ShinsaState, ActorStamp>();

export function applyStamped<T>(state: ShinsaState, stamp: ActorStamp, apply: () => T): T {
  ACTOR_STAMPS.set(state, stamp);
  try {
    return apply();
  } finally {
    ACTOR_STAMPS.delete(state);
  }
}

export function record(state: ShinsaState, taskId: string, at: number, entry: ActivityEntry) {
  const task = state.tasks[taskId];
  if (!task) return;
  const stamp = entry.actor === 'you' ? ACTOR_STAMPS.get(state) : undefined;
  const activity = [
    ...task.activity,
    { detail: null, evidenceId: null, ...entry, ...stamp, ...resolveRoundStamp(task), at },
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
