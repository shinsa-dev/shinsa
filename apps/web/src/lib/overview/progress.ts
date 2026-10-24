import type { DisplayPhase, DisplayPhaseStatus, TaskProgress } from '@shinsa/core';
import type { Tone } from '@/lib/format/tone.ts';

export type StepStatus = 'done' | 'current' | 'waiting' | 'pending' | 'skipped';

export interface Step {
  key: string;
  label: string;
  count: string | null;
  status: StepStatus;
  detail: { text: string; done: boolean }[];
}

const STEP_LABEL: Record<string, string> = {
  setup: 'Repository',
  answer: 'Answer',
  research: 'Research',
  investigate: 'Investigate',
  proposal: 'Your OK',
  plan: 'Plan',
  operate: 'Run',
  check: 'Checks',
  review: 'Your review',
  'pull-request': 'Pull request',
  merge: 'Merge',
};

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  done: 'Done',
  skipped: 'Skipped',
  current: 'In progress',
  waiting: 'Waiting on you',
  pending: 'Not started',
};

export const STEP_STATUS_TONE: Record<StepStatus, Tone> = {
  done: 'green',
  skipped: 'neutral',
  current: 'blue',
  waiting: 'amber',
  pending: 'neutral',
};

function toStepStatus(status: DisplayPhaseStatus): StepStatus {
  return status === 'active' ? 'current' : status;
}

function isFinished(phase: DisplayPhase) {
  return phase.status === 'done' || phase.status === 'skipped';
}

function resolveBuildStep(build: DisplayPhase[]): Step {
  const planned = build.filter((phase) => phase.planned);
  const finished = build.filter(isFinished).length;
  let status: StepStatus = 'pending';
  if (build.some((phase) => phase.status === 'active')) status = 'current';
  else if (finished === build.length) status = 'done';
  return {
    key: 'build',
    label: 'Build',
    count: planned.length > 1 ? `${finished}/${planned.length}` : null,
    status,
    detail: planned.map((phase, index) => ({
      text: `${index + 1}. ${phase.title}`,
      done: isFinished(phase),
    })),
  };
}

export function resolveSteps(progress: TaskProgress): Step[] {
  const build = progress.phases.filter((phase) => phase.planned || phase.key === 'build');
  const steps: Step[] = [];
  for (const phase of progress.phases) {
    if (phase === build[0]) steps.push(resolveBuildStep(build));
    if (phase.planned || phase.key === 'build') continue;
    steps.push({
      key: phase.key,
      label: STEP_LABEL[phase.key] ?? phase.title,
      count: null,
      status: toStepStatus(phase.status),
      detail: phase.detail ? [{ text: phase.detail, done: false }] : [],
    });
  }
  return steps;
}

export function isStepReached(step: Step) {
  return step.status === 'done' || step.status === 'skipped';
}

const LONG_STRIP = 6;

const LONGEST_FULL_STRIP = 8;

export type LabelFold = 'narrow' | 'always' | null;

export function resolveLabelFold(step: Step, steps: Step[]): LabelFold {
  if (steps.length <= LONG_STRIP || !isStepReached(step)) return null;
  return steps.length > LONGEST_FULL_STRIP ? 'always' : 'narrow';
}
