import {
  capitalise,
  type DisplayPhase,
  type DisplayPhaseStatus,
  type FixReason,
  type ShapeState,
  type Task,
  type TaskProgress,
} from '@shinsa/core';
import type { Tone } from '@/lib/format/tone.ts';

export type StepStatus = 'done' | 'current' | 'waiting' | 'pending' | 'skipped' | 'cancelled';

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
  'pre-merge': 'Pre-merge',
  merge: 'Merge',
  'post-merge': 'Post-merge',
};

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  done: 'Done',
  skipped: 'Skipped',
  current: 'In progress',
  waiting: 'Waiting on you',
  pending: 'Not started',
  cancelled: 'Cancelled',
};

export const STEP_STATUS_TONE: Record<StepStatus, Tone> = {
  done: 'green',
  skipped: 'neutral',
  current: 'blue',
  waiting: 'amber',
  pending: 'neutral',
  cancelled: 'neutral',
};

const CONFLICT_FIXES: ReadonlySet<FixReason | null> = new Set(['conflict', 'update']);

export function resolveStageNote(task: Pick<Task, 'stage' | 'fixFor' | 'stageReason'>) {
  if (task.stage !== 'fixing' || !CONFLICT_FIXES.has(task.fixFor) || !task.stageReason) return null;
  return capitalise(task.stageReason);
}

export function resolveStepStatusLabel(step: Step, note: string | null) {
  return step.status === 'current' && note ? note : STEP_STATUS_LABEL[step.status];
}

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
      count: phase.count ? `${phase.count.done}/${phase.count.total}` : null,
      status: toStepStatus(phase.status),
      detail: phase.detail && !phase.count ? [{ text: phase.detail, done: false }] : [],
    });
  }
  return steps;
}

export function isStepReached(step: Step) {
  return step.status === 'done' || step.status === 'skipped';
}

export function selectCurrentStep(steps: Step[]) {
  return steps.find((step) => step.status === 'current' || step.status === 'waiting') ?? null;
}

export function describeStep(step: Step) {
  return step.count ? `${step.label} ${step.count}` : step.label;
}

export function describeStepCount(step: Step | null, status: string) {
  if (!step?.count || status.split(' · ')[0] === step.label) return null;
  return describeStep(step);
}

export function describeTrackPosition(steps: Step[]) {
  const current = selectCurrentStep(steps);
  if (current) return `Step ${steps.indexOf(current) + 1} of ${steps.length}: ${describeStep(current)}`;
  return `${steps.filter(isStepReached).length} of ${steps.length} steps done`;
}

const LONG_STRIP = 6;

const LONGEST_FULL_STRIP = 8;

export type LabelFold = 'narrow' | 'always' | null;

const LONG_LABELS: ReadonlySet<string> = new Set(['pre-merge', 'post-merge']);

function resolveStripLength(steps: Step[]) {
  return steps.length + steps.filter((step) => LONG_LABELS.has(step.key)).length;
}

export function resolveLabelFold(step: Step, steps: Step[]): LabelFold {
  const length = resolveStripLength(steps);
  if (length <= LONG_STRIP || !isStepReached(step)) return null;
  return length > LONGEST_FULL_STRIP ? 'always' : 'narrow';
}

export const SHAPING_LABEL = 'Working out the steps';

export const SHAPING_NOTE: Record<Exclude<ShapeState, 'settled'>, string> = {
  triage: 'Shinsa is reading the request to choose what kind of task it is.',
  agent: 'The agent can still change the steps before it plans.',
};
