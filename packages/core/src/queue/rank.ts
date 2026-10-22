import {
  compareTasks,
  type Gate,
  type GateKind,
  PRIORITY_RANK,
  resolveAttentionLimit,
  type Task,
  type TaskStage,
} from '../model/index.ts';
import type { ShinsaState } from '../state/project.ts';
import {
  listActiveRuns,
  listDependents,
  listOpenBlockers,
  listOpenGates,
  listPendingDependencies,
  resolveTaskArea,
} from '../state/queries.ts';
import type { Queue, QueuedGate } from './types.ts';

const GATE_REASON: Record<GateKind, string> = {
  merge: 'Clean and ready to merge',
  review: 'Built, checked and ready for you',
  spec: 'Needs the plan approved before building starts',
  question: 'Needs an answer',
};

const KIND_RANK: Record<GateKind, number> = { merge: 0, review: 1, spec: 2, question: 3 };

const WORKING_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'triage',
  'planning',
  'building',
  'checking',
  'shipping',
  'awaiting_merge',
]);

function resolveGateRank(gate: Gate) {
  return KIND_RANK[gate.kind] + (gate.purpose === 'failure' ? 1 : 0);
}

export function resolveFocusArea(state: ShinsaState, now: number) {
  const { areaId, until } = state.focus;
  if (until !== null && until <= now) return null;
  return areaId;
}

export function listWaitsOn(state: ShinsaState, task: Task): Task[] {
  if (task.stage === 'queued') return listPendingDependencies(state, task);
  if (task.stage === 'shipping' || task.stage === 'awaiting_merge') return listOpenBlockers(state, task);
  return [];
}

function describeReason(entry: Omit<QueuedGate, 'reason'>) {
  if (entry.gate.purpose === 'failure') return 'Paused and needs a decision';
  if (entry.gate.purpose === 'agent_question') return 'An agent is waiting on your answer';
  if (entry.unblocks > 0)
    return `Unblocks ${entry.unblocks} other ${entry.unblocks === 1 ? 'task' : 'tasks'}`;
  if (entry.task.priority === 'urgent' || entry.task.priority === 'high') return 'Marked high priority';
  return GATE_REASON[entry.gate.kind];
}

function compareGates(a: QueuedGate, b: QueuedGate) {
  return (
    PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] ||
    b.unblocks - a.unblocks ||
    resolveGateRank(a.gate) - resolveGateRank(b.gate) ||
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
      areaId: resolveTaskArea(state, task),
      unblocks: listDependents(state, task.id).length,
    };
    return [{ ...base, reason: describeReason(base) }];
  });
}

export function resolveQueue(state: ShinsaState, now: number): Queue {
  const focusAreaId = resolveFocusArea(state, now);
  const inFocus = (areaId: string | null) => focusAreaId === null || areaId === focusAreaId;
  const entries = listQueuedGates(state);
  const tasksWithGates = new Set(entries.map((entry) => entry.task.id));

  const working: Task[] = [];
  const waiting: Task[] = [];
  for (const task of Object.values(state.tasks)) {
    if (tasksWithGates.has(task.id) || !inFocus(resolveTaskArea(state, task))) continue;
    if (listWaitsOn(state, task).length > 0) waiting.push(task);
    else if (WORKING_STAGES.has(task.stage) || listActiveRuns(state, task.id).length > 0) working.push(task);
  }

  const ready = entries.filter((entry) => inFocus(entry.areaId)).sort(compareGates);
  const limit = resolveAttentionLimit(state.settings);
  return {
    focusAreaId,
    ready,
    upNow: ready.slice(0, limit),
    later: ready.slice(limit),
    held: entries.filter((entry) => !inFocus(entry.areaId)).sort(compareGates),
    working: working.sort(compareTasks),
    waiting: waiting.sort(compareTasks),
  };
}
