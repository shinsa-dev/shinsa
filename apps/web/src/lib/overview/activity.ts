import type { Activity, ShinsaState, Task } from '@shinsa/core';
import { type Glyph, resolvePauseGlyph } from '@/lib/tasks/status.ts';

const ACTIVITY_GLYPH: Record<Activity['kind'], Glyph> = {
  asked: { icon: 'IconBubbleText', tone: 'neutral' },
  set_up: { icon: 'IconBranch', tone: 'neutral' },
  stage: { icon: 'IconArrowRight', tone: 'neutral' },
  plan: { icon: 'IconFileText', tone: 'purple' },
  decision: { icon: 'IconCheckCircle2', tone: 'blue' },
  work: { icon: 'IconHammer', tone: 'blue' },
  review: { icon: 'IconShieldCheck', tone: 'amber' },
  fix: { icon: 'IconArrowRotateClockwise', tone: 'amber' },
  pull_request: { icon: 'IconPullRequest', tone: 'green' },
  evidence: { icon: 'IconImages1', tone: 'blue' },
  message: { icon: 'IconBubbleText', tone: 'neutral' },
  note: { icon: 'IconNote1', tone: 'neutral' },
  failure: { icon: 'IconExclamationCircle', tone: 'red' },
  question: { icon: 'IconBubbleQuestion', tone: 'blue' },
  monitor: { icon: 'IconHourglass', tone: 'neutral' },
  suggestion: { icon: 'IconLightbulbGlow', tone: 'neutral' },
  answer: { icon: 'IconBubbleText', tone: 'blue' },
  account: { icon: 'IconUser', tone: 'neutral' },
  delegation: { icon: 'IconAgents', tone: 'blue' },
  shape: { icon: 'IconSplit', tone: 'purple' },
  round: { icon: 'IconArrowsRepeatCircle', tone: 'blue' },
};

export function resolveActivityGlyph(entry: Activity): Glyph {
  if (entry.gateType === 'failure') return ACTIVITY_GLYPH[entry.kind];
  return resolvePauseGlyph(entry.gateType) ?? ACTIVITY_GLYPH[entry.kind];
}

export const ACTOR_LABEL: Record<Activity['actor'], string> = {
  you: 'You',
  agent: 'Agent',
  shinsa: 'Shinsa',
};

export interface ActivityActor {
  label: string;
  taskId: string | null;
}

export function resolveActivityActor(state: ShinsaState, entry: Activity): ActivityActor {
  if (!entry.onBehalf) return { label: ACTOR_LABEL[entry.actor], taskId: null };
  const by = entry.byTask ? state.tasks[entry.byTask] : undefined;
  if (!by) return { label: 'Shinsa (on your behalf)', taskId: null };
  return { label: `${by.handle ?? `“${by.title}”`} agent (on your behalf)`, taskId: by.id };
}

export function resolveOverviewSummary(task: Task) {
  return task.report?.headline ?? task.summary ?? task.plan?.document?.goal ?? null;
}

export function listActivityNewestFirst(task: Task): Activity[] {
  return [...task.activity].reverse().sort((left, right) => right.at - left.at);
}
