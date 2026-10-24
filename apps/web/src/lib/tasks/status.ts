import {
  type Attention,
  type Gate,
  type GatePurpose,
  listActiveRuns,
  type ShinsaState,
  selectLeadGate,
  type Task,
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

const GATE_GLYPH: Record<Gate['kind'], Glyph> = {
  spec: { icon: 'IconFileText', tone: 'purple' },
  review: { icon: 'IconEyeOpen', tone: 'amber' },
  merge: { icon: 'IconMerged', tone: 'green' },
  question: { icon: 'IconBubbleQuestion', tone: 'blue' },
};

const GATE_STATUS: Record<Gate['kind'], Status> = {
  spec: { label: 'Plan to approve', tone: 'purple' },
  review: { label: 'Changes to review', tone: 'amber' },
  merge: { label: 'Ready to merge', tone: 'green' },
  question: { label: 'Needs your answer', tone: 'blue' },
};

const CHANGE_GLYPH: Glyph = { icon: 'IconFileEdit', tone: 'purple' };

const CHANGE: Status = { label: 'Change to approve', tone: 'purple' };

const OPERATION_GLYPH: Glyph = { icon: 'IconConsole', tone: 'purple' };

const OPERATION: Status = { label: 'Operation to confirm', tone: 'purple' };

const PAUSED: Status = { label: 'Paused', tone: 'orange' };

const SETUP: Status = { label: 'Setup incomplete', tone: 'orange' };

const WAITING_TO_CHECK: Status = { label: 'Waiting to check again', tone: 'blue' };

const SIGN_IN: Status = { label: 'Sign in needed', tone: 'orange' };

const WAITING_FOR_USAGE: Status = { label: 'Waiting for the usage limit', tone: 'blue' };

const WAITING_FOR_DELEGATIONS: Status = { label: 'Waiting for delegated tasks', tone: 'blue' };

export const ATTENTION: Record<Attention, Status> = {
  critical: { label: 'Critical', tone: 'red' },
  high: { label: 'Read carefully', tone: 'amber' },
  normal: { label: 'Context', tone: 'neutral' },
};

const PAUSE_GLYPH: Record<'failure' | 'configuration' | 'sign_in', Glyph> = {
  failure: { icon: 'IconPause', tone: 'orange' },
  configuration: { icon: 'IconToolbox', tone: 'orange' },
  sign_in: { icon: 'IconUserKey', tone: 'orange' },
};

export function resolvePauseGlyph(purpose: GatePurpose | undefined) {
  return purpose === 'configuration' || purpose === 'sign_in' || purpose === 'failure'
    ? PAUSE_GLYPH[purpose]
    : null;
}

export function resolveGateGlyph(gate: Gate): Glyph {
  const paused = resolvePauseGlyph(gate.purpose);
  if (paused) return paused;
  if (gate.purpose === 'change') return CHANGE_GLYPH;
  if (gate.purpose === 'operation') return OPERATION_GLYPH;
  return gate.purpose === 'agent_question' ? GATE_GLYPH.question : GATE_GLYPH[gate.kind];
}

export function resolveGateStatus(gate: Gate): Status {
  if (gate.purpose === 'failure') return PAUSED;
  if (gate.purpose === 'configuration') return SETUP;
  if (gate.purpose === 'sign_in') return SIGN_IN;
  if (gate.purpose === 'change') return CHANGE;
  if (gate.purpose === 'operation') return OPERATION;
  return gate.purpose === 'agent_question' ? GATE_STATUS.question : GATE_STATUS[gate.kind];
}

function isWaitingForDelegations(state: ShinsaState, task: Task) {
  return listActiveRuns(state, task.id).some(
    (run) => run.status === 'waiting' && (run.waitingOn?.delegations.length ?? 0) > 0
  );
}

export function resolveTaskStatus(state: ShinsaState, task: Task): Status {
  const gate = selectLeadGate(state, task);
  if (gate) return resolveGateStatus(gate);
  if (task.monitor?.status === 'armed') return WAITING_TO_CHECK;
  if (task.usageWait?.status === 'armed') return WAITING_FOR_USAGE;
  if (isWaitingForDelegations(state, task)) return WAITING_FOR_DELEGATIONS;
  if (task.stage !== 'queued' && resolveRoadmapGroup(state, task) === 'waiting') {
    return { label: ROADMAP_GROUP.waiting.title, tone: ROADMAP_GROUP.waiting.tone };
  }
  return { label: STAGE_LABEL[task.stage], tone: STAGE_TONE[task.stage] };
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
