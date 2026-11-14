import {
  type Attention,
  type Gate,
  type GateType,
  isHeldInBacklog,
  isPausingGate,
  isRetryArmed,
  resolveShownStage,
  type Run,
  type ShinsaState,
  selectLeadGate,
  type Task,
  type TaskStage,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { Option } from 'effect';
import { isAdmissionWait, isPaceWait, isUsageWaitArmed } from '@/lib/accounts/usage-wait.ts';
import { GATE, STAGE_ICON, STAGE_LABEL, STAGE_TONE } from '@/lib/format/labels.ts';
import { TONE_TEXT, type Tone } from '@/lib/format/tone.ts';
import { describePostMergeStatus, describePreMergeStatus } from '@/lib/review/merge-steps.ts';
import { BUNDLE_MERGING_STATUS, BUNDLE_READY_STATUS, isMergingWithBundle } from '@/lib/tasks/bundles.ts';
import { isHeldByTasks, resolveTaskGroup, TASK_GROUP } from '@/lib/tasks/groups.ts';
import { isWatchedTask } from '@/lib/tasks/watchdogs.ts';

export interface Status {
  label: string;
  tone: Tone;
}

export interface Glyph {
  icon: IconName;
  tone: Tone;
}

function resolveGlyph(type: GateType): Glyph {
  const { icon, tone } = GATE[type];
  return { icon, tone };
}

const RESOLVING_CONFLICTS = 'Resolving conflicts';

const RETRYING: Status = { label: 'Retrying', tone: 'amber' };

const WAITING_TO_CHECK_IN: Status = { label: 'Waiting to check in again', tone: 'neutral' };

const WAITING_FOR_USAGE: Status = { label: 'Waiting for the usage limit', tone: 'neutral' };

const HELD_AT_LIMIT: Status = { label: 'Held at a usage limit', tone: 'neutral' };

const WAITING_TO_BUILD: Status = { label: 'Waiting to build', tone: 'neutral' };

const WAITING_FOR_DELEGATIONS: Status = { label: 'Waiting for delegations', tone: 'neutral' };

const PAUSED: ReadonlySet<Status> = new Set([
  RETRYING,
  WAITING_TO_CHECK_IN,
  WAITING_FOR_USAGE,
  HELD_AT_LIMIT,
  WAITING_TO_BUILD,
  WAITING_FOR_DELEGATIONS,
]);

export function isPausedStatus(status: Status) {
  return PAUSED.has(status);
}

export const ATTENTION: Record<Attention, Status> = {
  critical: { label: 'Critical', tone: 'red' },
  high: { label: 'Read carefully', tone: 'amber' },
  normal: { label: 'Context', tone: 'neutral' },
};

export function resolvePauseGlyph(type: GateType | undefined) {
  return type && isPausingGate({ type }) ? resolveGlyph(type) : null;
}

export function resolveGateGlyph(gate: Gate): Glyph {
  return resolveGlyph(gate.type);
}

export function resolveGateStatus(gate: Gate): Status {
  const { label, tone } = GATE[gate.type];
  return { label, tone };
}

const WATCHING: Status = { label: 'Watching', tone: 'blue' };

const DUPLICATE: Status = { label: 'Duplicate', tone: 'neutral' };

const DELEGATION_WAITS = new WeakMap<Record<string, Run>, ReadonlySet<string>>();

function resolveDelegationWaits(runs: Record<string, Run>) {
  const known = DELEGATION_WAITS.get(runs);
  if (known) return known;
  const waiting = new Set<string>();
  for (const run of Object.values(runs)) {
    if (run.endedAt !== null || run.delegation || run.status !== 'waiting') continue;
    if ((run.waitingOn?.delegations.length ?? 0) > 0) waiting.add(run.taskId);
  }
  DELEGATION_WAITS.set(runs, waiting);
  return waiting;
}

function isWaitingForDelegations(state: ShinsaState, task: Task) {
  return resolveDelegationWaits(state.runs).has(task.id);
}

export function isResolvingConflicts(task: Pick<Task, 'stage' | 'fixFor'>) {
  return task.stage === 'fixing' && (task.fixFor === 'conflict' || task.fixFor === 'update');
}

export function resolveStageLabel(task: Task) {
  return isResolvingConflicts(task) ? RESOLVING_CONFLICTS : STAGE_LABEL[resolveShownStage(task)];
}

export function resolveTaskStatus(state: ShinsaState, task: Task): Status {
  const gate = Option.getOrNull(selectLeadGate(state, task));
  if (gate?.type === 'post_merge') return { label: describePostMergeStatus(task), tone: 'amber' };
  const before = gate?.type === 'merge' ? describePreMergeStatus(task) : null;
  if (before) return { label: before, tone: 'amber' };
  if (gate && isHeldInBacklog(state, gate))
    return { label: TASK_GROUP.backlog.title, tone: TASK_GROUP.backlog.tone };
  if (gate) return resolveGateStatus(gate);
  if (task.bundleReady && task.stage === 'shipping') return BUNDLE_READY_STATUS;
  if (isMergingWithBundle(state, task)) return BUNDLE_MERGING_STATUS;
  if (task.duplicate) return DUPLICATE;
  if (isWatchedTask(task)) return WATCHING;
  if (isRetryArmed(task)) return RETRYING;
  if (task.monitor?.status === 'armed') return WAITING_TO_CHECK_IN;
  if (isUsageWaitArmed(task)) {
    if (isAdmissionWait(task.usageWait)) return WAITING_TO_BUILD;
    return isPaceWait(task.usageWait) ? HELD_AT_LIMIT : WAITING_FOR_USAGE;
  }
  if (isWaitingForDelegations(state, task)) return WAITING_FOR_DELEGATIONS;
  if (task.stage !== 'waiting_on_tasks' && isHeldByTasks(state, task)) {
    return { label: 'Waiting on another task', tone: 'neutral' };
  }
  return { label: resolveStageLabel(task), tone: STAGE_TONE[resolveShownStage(task)] };
}

export function resolveRowStatus(state: ShinsaState, task: Task, gate: Gate | null = null): Status {
  if (gate?.type === 'post_merge') return { label: describePostMergeStatus(task), tone: 'amber' };
  const status = resolveTaskStatus(state, task);
  if (status !== WAITING_TO_CHECK_IN) return status;
  return { label: resolveStageLabel(task), tone: STAGE_TONE[resolveShownStage(task)] };
}

const STAGE_STATUS_ICON: Record<TaskStage, IconName> = {
  triage: 'IconPlayCircle',
  waiting_on_tasks: 'IconHourglass',
  planning: 'IconLightbulbGlow',
  awaiting_plan: GATE.plan.icon,
  building: 'IconHammer',
  checking: 'IconShieldCheck',
  reviewing: 'IconEyeSparkle',
  fixing: 'IconHammer2',
  awaiting_review: GATE.review.icon,
  shipping: 'IconRocket',
  awaiting_merge: GATE.merge.icon,
  answering: 'IconBubbleText',
  investigating: 'IconMagnifyingGlass',
  researching: 'IconBook',
  operating: 'IconConsole',
  watching: 'IconRadar',
  leading: 'IconAgents',
  awaiting_proposal: GATE.proposal.icon,
  awaiting_operation: GATE.operation.icon,
  answered: GATE.result.icon,
  merged: 'IconMerged',
  done: 'IconCheckCircle2',
  cancelled: 'IconCircleX',
};

export function resolveTaskStatusIcon(state: ShinsaState, task: Task): IconName {
  const gate = Option.getOrNull(selectLeadGate(state, task));
  if (gate && isHeldInBacklog(state, gate)) return TASK_GROUP.backlog.icon;
  if (gate) return resolveGateGlyph(gate).icon;
  if (task.duplicate) return TASK_GROUP.duplicate.icon;
  if (isWatchedTask(task)) return 'IconRadar';
  if (isRetryArmed(task)) return 'IconArrowRotateClockwise';
  if (task.monitor?.status === 'armed') return 'IconClockSnooze';
  if (isUsageWaitArmed(task)) return 'IconGauge';
  if (isWaitingForDelegations(state, task)) return 'IconAgents';
  if (task.stage !== 'waiting_on_tasks' && isHeldByTasks(state, task)) return 'IconHourglass';
  return STAGE_STATUS_ICON[resolveShownStage(task)];
}

export function resolveTaskGlyph(state: ShinsaState, task: Task): Glyph {
  const gate = Option.getOrNull(selectLeadGate(state, task));
  if (gate && !isHeldInBacklog(state, gate)) return resolveGateGlyph(gate);
  if (!gate && isHeldByTasks(state, task)) return { icon: 'IconHourglass', tone: 'neutral' };
  const group = TASK_GROUP[resolveTaskGroup(state, task)];
  if (group.key === 'working') return { icon: STAGE_ICON[task.stage] ?? group.icon, tone: group.tone };
  if (group.key === 'done' && resolveShownStage(task) === 'merged')
    return { icon: 'IconMerged', tone: group.tone };
  return { icon: group.icon, tone: group.tone };
}

export function resolveWorkingGlyph(task: Task): Glyph {
  return { icon: STAGE_ICON[task.stage] ?? 'IconRobot', tone: 'blue' };
}

export function resolveTaskMenuIcon(state: ShinsaState, task: Task) {
  const glyph = resolveTaskGlyph(state, task);
  return { name: glyph.icon, className: TONE_TEXT[glyph.tone] };
}
