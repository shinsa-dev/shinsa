import {
  listMergeSteps,
  type MergeStepKind,
  type MergeStepTiming,
  type MergeStepView,
  type Task,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { formatSteps } from '@/lib/format/count.ts';

export const MERGE_STEP_TITLE: Record<MergeStepTiming, string> = {
  pre_merge: 'Pre-merge steps',
  post_merge: 'Post-merge steps',
};

export const MERGE_STEP_ICON = {
  pre_merge: 'IconChecklist',
  post_merge: 'IconMerged',
} as const satisfies Record<MergeStepTiming, IconName>;

export const MERGE_STEP_KIND: Record<MergeStepKind, { label: string; icon: IconName }> = {
  env: { label: 'Environment variable', icon: 'IconKey1' },
  secret: { label: 'Secret', icon: 'IconLock' },
  migration: { label: 'Migration', icon: 'IconDatabase' },
  deploy: { label: 'Deploy', icon: 'IconRocket' },
  config: { label: 'Config', icon: 'IconSettingsSliderHor' },
  other: { label: 'Step', icon: 'IconChecklist' },
};

export function listTimedSteps(task: Task, when: MergeStepTiming) {
  return listMergeSteps(task).filter((step) => step.when === when);
}

export function countOpenSteps(task: Task, when: MergeStepTiming) {
  return listTimedSteps(task, when).filter((step) => !step.done).length;
}

export function describeMergeBlock(task: Task) {
  const open = countOpenSteps(task, 'pre_merge');
  if (open === 0) return null;
  return open === 1 ? 'Tick the pre-merge step first' : `Tick the ${open} pre-merge steps first`;
}

function countDuePostMergeSteps(task: Task) {
  return listTimedSteps(task, 'post_merge').filter((step) => step.due && !step.done).length;
}

export function describePreMergeStatus(task: Task) {
  const open = countOpenSteps(task, 'pre_merge');
  return open === 0 ? null : `Pre-merge · ${formatSteps(open)} left`;
}

export function describePostMergeStatus(task: Task) {
  return `Post-merge · ${formatSteps(countDuePostMergeSteps(task))} left`;
}

export function describePostMergeTitle(task: Task) {
  return `Merged. ${formatSteps(countDuePostMergeSteps(task))} left to do.`;
}

export function resolveTickBlock(task: Task, step: MergeStepView) {
  if (task.stage === 'cancelled') return 'The task was cancelled';
  if (step.done || step.due) return null;
  return step.when === 'pre_merge' ? 'The merge is done' : 'Tick it once the pull request merged';
}
