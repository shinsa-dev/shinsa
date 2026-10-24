import { describeUnblocks } from '../briefing/text.ts';
import { capitalise } from '../chat/text.ts';
import {
  compareTasks,
  type GateType,
  hasArmedWait,
  isDecisionGate,
  PRIORITY_RANK,
  resolveAttentionLimit,
  type Task,
  type TaskStage,
} from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';
import {
  listActiveRuns,
  listDependents,
  listOpenBlockers,
  listOpenGates,
  listPendingDependencies,
  resolveTaskProject,
  selectCheckoutHolder,
} from '../state/queries.ts';
import { resolveGateWords } from './reasons.ts';
import type { Queue, QueuedGate } from './types.ts';

const GATE_RANK: Record<GateType, number> = {
  merge: 0,
  review: 1,
  plan: 2,
  question: 3,
  secret: 3,
  proposal: 3,
  operation: 3,
  failure: 4,
  configuration: 4,
  sign_in: 4,
};

const WORKING_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'triage',
  'planning',
  'building',
  'checking',
  'shipping',
  'awaiting_merge',
]);

function isMoving(state: ShinsaState, task: Task) {
  return WORKING_STAGES.has(task.stage) || hasArmedWait(task) || listActiveRuns(state, task.id).length > 0;
}

export function resolveFocusProject(state: ShinsaState, now: number) {
  const { projectId, until } = state.focus;
  if (until !== null && until <= now) return null;
  return projectId;
}

export function isInFocus(state: ShinsaState, task: Task, now: number) {
  const projectId = resolveFocusProject(state, now);
  return projectId === null || resolveTaskProject(state, task) === projectId;
}

export function listWaitsOn(state: ShinsaState, task: Task): Task[] {
  if (task.stage === 'waiting_on_tasks') {
    const pending = listPendingDependencies(state, task);
    const holder = pending.length === 0 ? selectCheckoutHolder(state, task) : null;
    return holder ? [holder] : pending;
  }
  if (task.stage === 'shipping' || task.stage === 'awaiting_merge') return listOpenBlockers(state, task);
  return [];
}

function describeReason(entry: Omit<QueuedGate, 'reason'>) {
  const { reason } = resolveGateWords(entry.gate);
  if (!isDecisionGate(entry.gate)) return reason;
  if (entry.unblocks > 0) return capitalise(describeUnblocks(entry.unblocks));
  if (entry.task.priority === 'urgent' || entry.task.priority === 'high') return 'Marked high priority';
  return reason;
}

function compareGates(a: QueuedGate, b: QueuedGate) {
  return (
    PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] ||
    b.unblocks - a.unblocks ||
    GATE_RANK[a.gate.type] - GATE_RANK[b.gate.type] ||
    a.gate.openedAt - b.gate.openedAt
  );
}

function listQueuedGates(state: ShinsaState): QueuedGate[] {
  return listOpenGates(state).flatMap((gate) => {
    const task = state.tasks[gate.taskId];
    if (!task) return [];
    const base = {
      gate,
      task,
      projectId: resolveTaskProject(state, task),
      unblocks: listDependents(state, task.id).length,
    };
    return [{ ...base, reason: describeReason(base) }];
  });
}

export function resolveQueue(state: ShinsaState, now: number): Queue {
  const entries = listQueuedGates(state);
  const tasksWithGates = new Set(entries.map((entry) => entry.task.id));

  const working: Task[] = [];
  const waiting: Task[] = [];
  for (const task of Object.values(state.tasks)) {
    if (tasksWithGates.has(task.id) || !isInFocus(state, task, now)) continue;
    if (listWaitsOn(state, task).length > 0) waiting.push(task);
    else if (isMoving(state, task)) working.push(task);
  }

  const ready = entries.filter((entry) => isInFocus(state, entry.task, now)).sort(compareGates);
  const limit = resolveAttentionLimit(state.settings);
  return {
    focusProjectId: resolveFocusProject(state, now),
    ready,
    upNow: ready.slice(0, limit),
    later: ready.slice(limit),
    working: working.sort(compareTasks),
    waiting: waiting.sort(compareTasks),
  };
}
