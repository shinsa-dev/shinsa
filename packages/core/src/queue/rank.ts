import { Option } from 'effect';
import { describeUnblocks } from '../briefing/text.ts';
import { capitalise, describeCount } from '../chat/text.ts';
import {
  compareTasks,
  type FocusProjects,
  type Gate,
  type GateType,
  hasArmedWait,
  isDecisionGate,
  isProjectInFocus,
  isTaskSettled,
  isWatchCheck,
  isWatchHome,
  NO_FOCUS_PROJECTS,
  PRIORITY_RANK,
  resolveAttentionLimit,
  resolveFocusSelection,
  selectSingleFocusProject,
  type Task,
  type TaskStage,
} from '../domain/index.ts';
import { listOpenMergeSteps } from '../report/merge-steps.ts';
import { isTeamTask } from '../share/teams.ts';
import type { ShinsaState } from '../state/project.ts';
import {
  isHeldInBacklog,
  listBundleBlockers,
  listOpenBlockers,
  listOpenGates,
  listPendingDependencies,
  resolveActiveRunTasks,
  resolveTaskProject,
} from '../state/queries.ts';
import { resolveGateWords } from './reasons.ts';
import type { Queue, QueuedGate } from './types.ts';

const GATE_RANK: Record<GateType, number> = {
  merge: 0,
  review: 1,
  plan: 2,
  question: 3,
  secret: 3,
  browser_sign_in: 3,
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

function isMoving(task: Task, running: ReadonlySet<string>, judging: ReadonlySet<string>) {
  return WORKING_STAGES.has(task.stage) || hasArmedWait(task) || running.has(task.id) || judging.has(task.id);
}

function listJudgedTasks(state: ShinsaState) {
  return new Set(
    listOpenGates(state)
      .filter((gate) => gate.autopilotJudging === true)
      .map((gate) => gate.taskId)
  );
}

function isFocusOver(state: ShinsaState, now: number) {
  const { until } = state.focus;
  return until !== null && until <= now;
}

export function resolveFocusProjects(state: ShinsaState, now: number): FocusProjects {
  if (isFocusOver(state, now) || state.focus.teamId !== null || state.focus.initiativeId)
    return NO_FOCUS_PROJECTS;
  return resolveFocusSelection(state.focus);
}

export function resolveFocusProject(state: ShinsaState, now: number) {
  return Option.getOrNull(selectSingleFocusProject(resolveFocusProjects(state, now)));
}

export function resolveFocusTeam(state: ShinsaState, now: number): Option.Option<string> {
  return isFocusOver(state, now) ? Option.none() : Option.fromNullishOr(state.focus.teamId);
}

export function resolveFocusInitiative(state: ShinsaState, now: number): Option.Option<string> {
  return isFocusOver(state, now) ? Option.none() : Option.fromNullishOr(state.focus.initiativeId);
}

export function isInFocus(state: ShinsaState, task: Task, now: number) {
  if (state.teammateTasks?.[task.id]) return false;
  const initiativeId = resolveFocusInitiative(state, now);
  if (Option.isSome(initiativeId)) return task.initiativeId === initiativeId.value;
  const teamId = resolveFocusTeam(state, now);
  if (Option.isSome(teamId)) return isTeamTask(state, task, teamId.value);
  return isProjectInFocus(
    resolveFocusProjects(state, now),
    Option.getOrNull(resolveTaskProject(state, task))
  );
}

export function isListedInFocus(state: ShinsaState, task: Task, now: number) {
  return !isWatchHome(task) && isInFocus(state, task, now);
}

const HELD_DECISIONS: Partial<Record<TaskStage, GateType>> = {
  awaiting_plan: 'plan',
  awaiting_review: 'review',
  awaiting_proposal: 'proposal',
};

export function isDecisionHeld(state: ShinsaState, task: Task) {
  return HELD_DECISIONS[task.stage] !== undefined && listOpenBlockers(state, task).length > 0;
}

export function isGateHeld(state: ShinsaState, gate: Gate) {
  const task = state.tasks[gate.taskId];
  if (!task || HELD_DECISIONS[task.stage] !== gate.type) return false;
  return isDecisionHeld(state, task);
}

export function listWaitsOn(state: ShinsaState, task: Task): Task[] {
  if (task.stage === 'waiting_on_tasks') {
    return listPendingDependencies(state, task);
  }
  if (task.stage === 'shipping' || task.stage === 'awaiting_merge' || HELD_DECISIONS[task.stage]) {
    return listOpenBlockers(state, task);
  }
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
    (gate) =>
      !isHeldInBacklog(state, gate) &&
      !state.tasks[gate.taskId]?.snoozed &&
      !isGateHeld(state, gate) &&
      gate.autopilotJudging !== true
  );
  const dependents = open.length > 0 ? countDependents(state) : new Map<string, number>();
  return open.flatMap((gate) => {
    const task = state.tasks[gate.taskId];
    if (!task) return [];
    const base = {
      gate,
      task,
      projectId: Option.getOrNull(resolveTaskProject(state, task)),
      unblocks: dependents.get(task.id) ?? 0,
    };
    return [{ ...base, reason: describeReason(base) }];
  });
}

function listLeadingGates(entries: QueuedGate[]) {
  const decided = new Set(
    entries.filter((entry) => entry.gate.type !== 'post_merge').map((entry) => entry.task.id)
  );
  return entries.filter((entry) => entry.gate.type !== 'post_merge' || !decided.has(entry.task.id));
}

export function resolveQueue(state: ShinsaState, now: number): Queue {
  const entries = listLeadingGates(listQueuedGates(state));
  const tasksWithGates = new Set(entries.map((entry) => entry.task.id));

  const running = resolveActiveRunTasks(state);
  const judging = listJudgedTasks(state);
  const working: Task[] = [];
  const waiting: Task[] = [];
  const backlog: Task[] = [];
  const snoozed: Task[] = [];
  for (const task of Object.values(state.tasks)) {
    if (tasksWithGates.has(task.id) || !isListedInFocus(state, task, now)) continue;
    if (task.snoozed && !isTaskSettled(task)) snoozed.push(task);
    else if (task.backlog && !isTaskSettled(task)) backlog.push(task);
    else if (listWaitsOn(state, task).length > 0 || listBundleBlockers(state, task).length > 0) {
      waiting.push(task);
    } else if (!isWatchCheck(task) && isMoving(task, running, judging)) working.push(task);
  }

  const ready = entries.filter((entry) => isInFocus(state, entry.task, now)).sort(compareGates);
  const limit = resolveAttentionLimit(state.settings);
  return {
    focus: resolveFocusProjects(state, now),
    focusTeamId: Option.getOrNull(resolveFocusTeam(state, now)),
    focusInitiativeId: Option.getOrNull(resolveFocusInitiative(state, now)),
    ready,
    upNow: ready.slice(0, limit),
    later: ready.slice(limit),
    working: working.sort(compareTasks),
    waiting: waiting.sort(compareTasks),
    backlog: backlog.sort(compareTasks),
    snoozed: snoozed.sort(compareTasks),
  };
}
