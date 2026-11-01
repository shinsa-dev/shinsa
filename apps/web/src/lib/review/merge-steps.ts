import {
  type ChecklistItem,
  isTaskComplete,
  isTaskSettled,
  listBundleBelow,
  listMergeSteps,
  type MergeStepKind,
  type MergeStepTiming,
  type MergeStepView,
  type ShinsaState,
  serializeReference,
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

export const MERGE_WAIT_KIND: Record<MergeWaitView['kind'], { label: string; icon: IconName }> = {
  wait: { label: 'Linked task', icon: 'IconHourglass' },
  bundle: { label: 'Bundle', icon: 'IconLayersThree' },
};

export function listTimedSteps(task: Task, when: MergeStepTiming) {
  return listMergeSteps(task).filter((step) => step.when === when);
}

export function countOpenSteps(task: Task, when: MergeStepTiming) {
  return listTimedSteps(task, when).filter((step) => !step.done).length;
}

export function resolveMergeLabel(state: Pick<ShinsaState, 'tasks'>, task: Task, fallback: string) {
  const below = listBundleBelow(state, task).filter((member) => member.pullRequest).length;
  if (below > 0) return `Merge ${below + 1} pull requests`;
  return task.pullRequest ? `Merge #${task.pullRequest.number}` : fallback;
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

export interface MergeWaitView extends ChecklistItem {
  taskId: string;
  kind: 'wait' | 'bundle';
}

export type PreMergeItem = MergeStepView | MergeWaitView;

export function isMergeWait(item: PreMergeItem): item is MergeWaitView {
  return 'taskId' in item;
}

function linkTask(task: Task) {
  return `[${task.title}](${serializeReference({ kind: 'task', id: task.id })})`;
}

function listBundleWaits(state: Pick<ShinsaState, 'tasks'>, task: Task): MergeWaitView[] {
  return listBundleBelow(state, task).map((below) => ({
    key: `bundle:${below.id}`,
    taskId: below.id,
    kind: 'bundle',
    title: `${linkTask(below)} merges with this one`,
    detail: null,
    command: null,
    done: Boolean(below.bundleReady) || isTaskComplete(below),
  }));
}

export function listMergeWaits(state: Pick<ShinsaState, 'tasks'>, task: Task): MergeWaitView[] {
  const waits = task.waitsOn.flatMap((id): MergeWaitView[] => {
    const other = state.tasks[id];
    if (!other) return [];
    const link = linkTask(other);
    return [
      {
        key: `wait:${id}`,
        taskId: id,
        kind: 'wait',
        title:
          other.stage === 'cancelled'
            ? `No longer waits for ${link}: it was cancelled`
            : `Merges after ${link} finishes`,
        detail: null,
        command: null,
        done: isTaskSettled(other),
      },
    ];
  });
  return [...listBundleWaits(state, task), ...waits];
}

export function resolveWaitBlock(wait: MergeWaitView) {
  if (wait.kind === 'bundle') {
    return wait.done ? 'That task is ready to merge' : 'Ticks itself once that task is ready to merge';
  }
  return wait.done ? 'That task finished' : 'Ticks itself once that task finishes';
}
