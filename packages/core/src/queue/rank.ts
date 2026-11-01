import { describeUnblocks } from '../briefing/text.ts';
import { capitalise, describeCount } from '../chat/text.ts';
import {
  compareTasks,
  type GateType,
  hasArmedWait,
  isDecisionGate,
  isTaskSettled,
  isWatchHome,
  PRIORITY_RANK,
  resolveAttentionLimit,
  type Task,
  type TaskStage,
} from '../domain/index.ts';
import { listOpenMergeSteps } from '../report/merge-steps.ts';
import { isTeamTask } from '../share/teams.ts';
import type { ShinsaState } from '../state/project.ts';
import {
  isHeldInBacklog,
  listOpenBlockers,
  listOpenGates,
  listPendingDependencies,
  resolveActiveRunTasks,
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
  post_merge: 3,
  result: 3,
};

const WORKING_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'triage',
  'planning',
  'building',
  'checking',
  'shipping',
  'awaiting_merge',
]);

function isMoving(task: Task, running: ReadonlySet<string>) {
  return WORKING_STAGES.has(task.stage) || hasArmedWait(task) || running.has(task.id);
}

function isFocusOver(state: ShinsaState, now: number) {
  const { until } = state.focus;
  return until !== null && until <= now;
}

export function resolveFocusProject(state: ShinsaState, now: number) {
  return isFocusOver(state, now) ? null : state.focus.projectId;
}

export function resolveFocusTeam(state: ShinsaState, now: number) {
  return isFocusOver(state, now) ? null : state.focus.teamId;
}

export function isInFocus(state: ShinsaState, task: Task, now: number) {
  const teamId = resolveFocusTeam(state, now);
  if (teamId !== null) return isTeamTask(state, task, teamId);
  const projectId = resolveFocusProject(state, now);
  return projectId === null || resolveTaskProject(state, task) === projectId;
}

export function isListedInFocus(state: ShinsaState, task: Task, now: number) {
  return !isWatchHome(task) && isInFocus(state, task, now);
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

function describePreMerge(task: Task) {
  const open = listOpenMergeSteps(task, 'pre_merge').length;
  return `${capitalise(describeCount(open, 'pre-merge step'))} for you`;
}

function describeReason(entry: Omit<QueuedGate, 'reason'>) {
  const { reason } = resolveGateWords(entry.gate);
  if (entry.gate.type === 'merge' && listOpenMergeSteps(entry.task, 'pre_merge').length > 0) {
    return describePreMerge(entry.task);
  }
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

function countDependents(state: ShinsaState) {
  const counts = new Map<string, number>();
  for (const task of Object.values(state.tasks)) {
    if (isTaskSettled(task)) continue;
    for (const id of new Set(task.waitsOn)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function listQueuedGates(state: ShinsaState): QueuedGate[] {
  const open = listOpenGates(state).filter(
    (gate) => !isHeldInBacklog(state, gate) && !state.tasks[gate.taskId]?.snoozed
  );
  const dependents = open.length > 0 ? countDependents(state) : new Map<string, number>();
  return open.flatMap((gate) => {
    const task = state.tasks[gate.taskId];
    if (!task) return [];
    const base = {
      gate,
      task,
      projectId: resolveTaskProject(state, task),
      unblocks: dependents.get(task.id) ?? 0,
    };
    return [{ ...base, reason: describeReason(base) }];
  });
}

export function resolveQueue(state: ShinsaState, now: number): Queue {
  const entries = listQueuedGates(state);
  const tasksWithGates = new Set(
    entries.filter((entry) => entry.gate.type !== 'post_merge').map((entry) => entry.task.id)
  );

  const running = resolveActiveRunTasks(state);
  const working: Task[] = [];
  const waiting: Task[] = [];
  const backlog: Task[] = [];
  const snoozed: Task[] = [];
  for (const task of Object.values(state.tasks)) {
    if (tasksWithGates.has(task.id) || !isListedInFocus(state, task, now)) continue;
    if (task.snoozed && !isTaskSettled(task)) snoozed.push(task);
    else if (task.backlog && !isTaskSettled(task)) backlog.push(task);
    else if (listWaitsOn(state, task).length > 0) waiting.push(task);
    else if (isMoving(task, running)) working.push(task);
  }

  const ready = entries.filter((entry) => isInFocus(state, entry.task, now)).sort(compareGates);
  const limit = resolveAttentionLimit(state.settings);
  return {
    focusProjectId: resolveFocusProject(state, now),
    focusTeamId: resolveFocusTeam(state, now),
    ready,
    upNow: ready.slice(0, limit),
    later: ready.slice(limit),
    working: working.sort(compareTasks),
    waiting: waiting.sort(compareTasks),
    backlog: backlog.sort(compareTasks),
    snoozed: snoozed.sort(compareTasks),
  };
}
