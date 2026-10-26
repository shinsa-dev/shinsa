import {
  type Attention,
  type Gate,
  type GateType,
  listActiveRuns,
  type ShinsaState,
  selectLeadGate,
  type Task,
  type TaskStage,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { STAGE_ICON, STAGE_LABEL, STAGE_TONE } from '@/lib/format/labels.ts';
import { TONE_TEXT, type Tone } from '@/lib/format/tone.ts';
import { ROADMAP_GROUP, resolveRoadmapGroup } from '@/lib/tasks/roadmap.ts';

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
};

const WAITING_TO_CHECK_IN: Status = { label: 'Waiting to check in again', tone: 'blue' };

const WAITING_FOR_USAGE: Status = { label: 'Waiting for the usage limit', tone: 'blue' };

const WAITING_FOR_DELEGATIONS: Status = { label: 'Waiting for delegations', tone: 'blue' };

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

function isWaitingForDelegations(state: ShinsaState, task: Task) {
  return listActiveRuns(state, task.id).some(
    (run) => run.status === 'waiting' && (run.waitingOn?.delegations.length ?? 0) > 0
  );
}

export function resolveTaskStatus(state: ShinsaState, task: Task): Status {
  const gate = selectLeadGate(state, task);
  if (gate) return resolveGateStatus(gate);
  if (task.monitor?.status === 'armed') return WAITING_TO_CHECK_IN;
  if (task.usageWait?.status === 'armed') return WAITING_FOR_USAGE;
  if (isWaitingForDelegations(state, task)) return WAITING_FOR_DELEGATIONS;
  if (task.stage !== 'waiting_on_tasks' && resolveRoadmapGroup(state, task) === 'waiting') {
    return { label: ROADMAP_GROUP.waiting.title, tone: ROADMAP_GROUP.waiting.tone };
  }
  return { label: STAGE_LABEL[task.stage], tone: STAGE_TONE[task.stage] };
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
  awaiting_proposal: GATE_GLYPH.proposal.icon,
  awaiting_operation: GATE_GLYPH.operation.icon,
  merged: 'IconMerged',
  done: 'IconCheckCircle2',
  cancelled: 'IconCircleX',
};

export function resolveTaskStatusIcon(state: ShinsaState, task: Task): IconName {
  const gate = selectLeadGate(state, task);
  if (gate) return resolveGateGlyph(gate).icon;
  if (task.monitor?.status === 'armed') return 'IconClockSnooze';
  if (task.usageWait?.status === 'armed') return 'IconGauge';
  if (isWaitingForDelegations(state, task)) return 'IconAgents';
  if (task.stage !== 'waiting_on_tasks' && resolveRoadmapGroup(state, task) === 'waiting') {
    return ROADMAP_GROUP.waiting.icon;
  }
  return STAGE_STATUS_ICON[task.stage];
}

export function resolveTaskGlyph(state: ShinsaState, task: Task): Glyph {
  const gate = selectLeadGate(state, task);
  if (gate) return resolveGateGlyph(gate);
  const group = ROADMAP_GROUP[resolveRoadmapGroup(state, task)];
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
