import { type Attention, type Gate, listOpenGates, type ShinsaState, type Task } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { STAGE_ICON, STAGE_LABEL, STAGE_TONE } from '@/lib/format/labels.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { ROADMAP_GROUP, resolveRoadmapGroup } from './roadmap.ts';

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

const PAUSED: Status = { label: 'Paused', tone: 'orange' };

export const ATTENTION: Record<Attention, Status> = {
  critical: { label: 'Critical', tone: 'red' },
  high: { label: 'Read carefully', tone: 'amber' },
  normal: { label: 'Context', tone: 'neutral' },
};

export function selectLeadGate(state: ShinsaState, taskId: string) {
  const gates = listOpenGates(state, taskId);
  return gates.find((gate) => gate.purpose !== 'decision') ?? gates[0] ?? null;
}

export function resolveGateGlyph(gate: Gate): Glyph {
  if (gate.purpose === 'failure') return { icon: 'IconPause', tone: 'orange' };
  return gate.purpose === 'agent_question' ? GATE_GLYPH.question : GATE_GLYPH[gate.kind];
}

export function resolveGateStatus(gate: Gate): Status {
  if (gate.purpose === 'failure') return PAUSED;
  return gate.purpose === 'agent_question' ? GATE_STATUS.question : GATE_STATUS[gate.kind];
}

export function resolveTaskStatus(state: ShinsaState, task: Task): Status {
  const gate = selectLeadGate(state, task.id);
  if (gate) return resolveGateStatus(gate);
  if (resolveRoadmapGroup(state, task) === 'waiting') return { label: 'Not started', tone: 'neutral' };
  return { label: STAGE_LABEL[task.stage], tone: STAGE_TONE[task.stage] };
}

export function resolveTaskGlyph(state: ShinsaState, task: Task): Glyph {
  const group = ROADMAP_GROUP[resolveRoadmapGroup(state, task)];
  if (group.key === 'working') return { icon: STAGE_ICON[task.stage] ?? group.icon, tone: group.tone };
  if (group.key === 'done' && task.stage === 'merged') return { icon: 'IconMerged', tone: group.tone };
  return { icon: group.icon, tone: group.tone };
}

export function resolveWorkingGlyph(task: Task): Glyph {
  return { icon: STAGE_ICON[task.stage] ?? 'IconRobot', tone: 'blue' };
}
