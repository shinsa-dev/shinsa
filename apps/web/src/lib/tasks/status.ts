import {
  type Attention,
  type Gate,
  type GateType,
  isHeldInBacklog,
  listActiveRuns,
  type ShinsaState,
  selectLeadGate,
  type Task,
  type TaskStage,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { STAGE_ICON, STAGE_LABEL, STAGE_TONE } from '@/lib/format/labels.ts';
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

const QUESTION_GLYPH: Glyph = { icon: 'IconBubbleQuestion', tone: 'blue' };

const QUESTION: Status = { label: 'Needs your answer', tone: 'blue' };

const GATE_GLYPH: Record<GateType, Glyph> = {
  plan: { icon: 'IconFileText', tone: 'purple' },
  review: { icon: 'IconEyeOpen', tone: 'amber' },
  merge: { icon: 'IconMerged', tone: 'green' },
  question: QUESTION_GLYPH,
  secret: QUESTION_GLYPH,
  proposal: { icon: 'IconFileEdit', tone: 'purple' },
  operation: { icon: 'IconConsole', tone: 'purple' },
  failure: { icon: 'IconPause', tone: 'orange' },
  configuration: { icon: 'IconToolbox', tone: 'orange' },
  sign_in: { icon: 'IconUserKey', tone: 'orange' },
  post_merge: { icon: 'IconChecklist', tone: 'amber' },
  result: { icon: 'IconBubbleCheck', tone: 'blue' },
};

const GATE_STATUS: Record<GateType, Status> = {
  plan: { label: 'Plan to approve', tone: 'purple' },
  review: { label: 'Changes to review', tone: 'amber' },
  merge: { label: 'Ready to merge', tone: 'green' },
  question: QUESTION,
  secret: QUESTION,
  proposal: { label: 'Change to approve', tone: 'purple' },
  operation: { label: 'Operation to confirm', tone: 'purple' },
  failure: { label: 'Paused', tone: 'orange' },
  configuration: { label: 'Setup incomplete', tone: 'orange' },
  sign_in: { label: 'Sign in needed', tone: 'orange' },
  post_merge: { label: 'Post-merge', tone: 'amber' },
  result: { label: 'Answered', tone: 'blue' },
};

const RESOLVING_CONFLICTS = 'Resolving conflicts';

const WAITING_TO_CHECK_IN: Status = { label: 'Waiting to check in again', tone: 'neutral' };

const WAITING_FOR_USAGE: Status = { label: 'Waiting for the usage limit', tone: 'neutral' };

const WAITING_FOR_DELEGATIONS: Status = { label: 'Waiting for delegations', tone: 'neutral' };

const PAUSED: ReadonlySet<Status> = new Set([
  WAITING_TO_CHECK_IN,
  WAITING_FOR_USAGE,
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
  return type === 'configuration' || type === 'sign_in' || type === 'failure' ? GATE_GLYPH[type] : null;
}

export function resolveGateGlyph(gate: Gate): Glyph {
  return GATE_GLYPH[gate.type];
}

export function resolveGateStatus(gate: Gate): Status {
  return GATE_STATUS[gate.type];
}

const WATCHING: Status = { label: 'Watching', tone: 'blue' };

const DUPLICATE: Status = { label: 'Duplicate', tone: 'neutral' };

function isWaitingForDelegations(state: ShinsaState, task: Task) {
  return listActiveRuns(state, task.id).some(
    (run) => run.status === 'waiting' && (run.waitingOn?.delegations.length ?? 0) > 0
  );
}

export function isResolvingConflicts(task: Task) {
  return task.stage === 'fixing' && (task.fixFor === 'conflict' || task.fixFor === 'update');
}

export function resolveStageLabel(task: Task) {
  return isResolvingConflicts(task) ? RESOLVING_CONFLICTS : STAGE_LABEL[task.stage];
}

export function resolveTaskStatus(state: ShinsaState, task: Task): Status {
  const gate = selectLeadGate(state, task);
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
  if (task.monitor?.status === 'armed') return WAITING_TO_CHECK_IN;
  if (task.usageWait?.status === 'armed') return WAITING_FOR_USAGE;
  if (isWaitingForDelegations(state, task)) return WAITING_FOR_DELEGATIONS;
  if (task.stage !== 'waiting_on_tasks' && isHeldByTasks(state, task)) {
    return { label: 'Waiting on another task', tone: 'neutral' };
  }
  return { label: resolveStageLabel(task), tone: STAGE_TONE[task.stage] };
}

export function resolveRowStatus(state: ShinsaState, task: Task): Status {
  const status = resolveTaskStatus(state, task);
  if (status !== WAITING_TO_CHECK_IN) return status;
  return { label: resolveStageLabel(task), tone: STAGE_TONE[task.stage] };
}

const STAGE_STATUS_ICON: Record<TaskStage, IconName> = {
  triage: 'IconPlayCircle',
  waiting_on_tasks: 'IconHourglass',
  planning: 'IconLightbulbGlow',
  awaiting_plan: GATE_GLYPH.plan.icon,
  building: 'IconHammer',
  checking: 'IconShieldCheck',
  reviewing: 'IconEyeSparkle',
  fixing: 'IconHammer2',
  awaiting_review: GATE_GLYPH.review.icon,
  shipping: 'IconRocket',
  awaiting_merge: GATE_GLYPH.merge.icon,
  answering: 'IconBubbleText',
  investigating: 'IconMagnifyingGlass',
  researching: 'IconBook',
  operating: 'IconConsole',
  watching: 'IconRadar',
  awaiting_proposal: GATE_GLYPH.proposal.icon,
  awaiting_operation: GATE_GLYPH.operation.icon,
  answered: GATE_GLYPH.result.icon,
  merged: 'IconMerged',
  done: 'IconCheckCircle2',
  cancelled: 'IconCircleX',
};

export function resolveTaskStatusIcon(state: ShinsaState, task: Task): IconName {
  const gate = selectLeadGate(state, task);
  if (gate && isHeldInBacklog(state, gate)) return TASK_GROUP.backlog.icon;
  if (gate) return resolveGateGlyph(gate).icon;
  if (task.duplicate) return TASK_GROUP.duplicate.icon;
  if (isWatchedTask(task)) return 'IconRadar';
  if (task.monitor?.status === 'armed') return 'IconClockSnooze';
  if (task.usageWait?.status === 'armed') return 'IconGauge';
  if (isWaitingForDelegations(state, task)) return 'IconAgents';
  if (task.stage !== 'waiting_on_tasks' && isHeldByTasks(state, task)) return 'IconHourglass';
  return STAGE_STATUS_ICON[task.stage];
}

export function resolveTaskGlyph(state: ShinsaState, task: Task): Glyph {
  const gate = selectLeadGate(state, task);
  if (gate && !isHeldInBacklog(state, gate)) return resolveGateGlyph(gate);
  if (!gate && isHeldByTasks(state, task)) return { icon: 'IconHourglass', tone: 'neutral' };
  const group = TASK_GROUP[resolveTaskGroup(state, task)];
  if (group.key === 'working') return { icon: STAGE_ICON[task.stage] ?? group.icon, tone: group.tone };
  if (group.key === 'done' && task.stage === 'merged') return { icon: 'IconMerged', tone: group.tone };
  return { icon: group.icon, tone: group.tone };
}

export function resolveWorkingGlyph(task: Task): Glyph {
  return { icon: STAGE_ICON[task.stage] ?? 'IconRobot', tone: 'blue' };
}

export function resolveTaskMenuIcon(state: ShinsaState, task: Task) {
  const glyph = resolveTaskGlyph(state, task);
  return { name: glyph.icon, className: TONE_TEXT[glyph.tone] };
}
