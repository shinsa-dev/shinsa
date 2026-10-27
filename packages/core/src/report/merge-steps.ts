import { resolveCurrentRound, resolveTaskRounds } from '../domain/rounds.ts';
import type { PhaseReport, Task } from '../domain/types.ts';
import type { ChecklistItem } from './checklist.ts';
import type { CarriedMergeStep, MergeStep, MergeStepTiming, ReportWalkthrough } from './types.ts';

export type MergeStepView = MergeStep &
  ChecklistItem & {
    round: number;
    due: boolean;
  };

export const MERGE_STEP_WHEN_WORDS: Record<MergeStepTiming, string> = {
  pre_merge: 'before the merge',
  post_merge: 'after the merge',
};

type MergeStepSource = Pick<
  Task,
  | 'phaseReports'
  | 'mergeStepsDone'
  | 'carriedMergeSteps'
  | 'rounds'
  | 'request'
  | 'title'
  | 'createdAt'
  | 'pipeline'
  | 'mode'
  | 'branch'
  | 'pullRequest'
  | 'stage'
>;

export function resolveLatestWalkthrough(reports: readonly PhaseReport[]) {
  return [...reports]
    .sort((a, b) => a.index - b.index)
    .reduce<ReportWalkthrough | null>((latest, report) => report.walkthrough ?? latest, null);
}

function hashText(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function resolveMergeStepKey(step: MergeStep) {
  const content = [step.kind, step.title, step.detail, step.command ?? ''].join('\u0000');
  return `${step.when}:${hashText(content)}`;
}

function toMergeStep(step: MergeStep): MergeStep {
  return { when: step.when, kind: step.kind, title: step.title, detail: step.detail, command: step.command };
}

function isCarriedDue(task: MergeStepSource, step: CarriedMergeStep) {
  const status = resolveTaskRounds(task).find((round) => round.number === step.round)?.status;
  if (step.when === 'pre_merge') return status === 'shipped';
  return status === 'merged' || status === 'finished';
}

function isCurrentDue(task: MergeStepSource, step: MergeStep) {
  const merged = task.pullRequest?.state === 'merged';
  return step.when === 'pre_merge' ? !merged : merged;
}

function listCurrentMergeSteps(task: MergeStepSource): MergeStep[] {
  return (resolveLatestWalkthrough(task.phaseReports)?.steps ?? []).map(toMergeStep);
}

export function listMergeSteps(task: MergeStepSource): MergeStepView[] {
  const done = new Set(task.mergeStepsDone ?? []);
  const seen = new Set<string>();
  const views: MergeStepView[] = [];
  for (const step of task.carriedMergeSteps ?? []) {
    const key = resolveMergeStepKey(step);
    if (seen.has(key)) continue;
    seen.add(key);
    views.push({
      ...toMergeStep(step),
      key,
      done: step.done,
      round: step.round,
      due: isCarriedDue(task, step),
    });
  }
  const round = resolveCurrentRound(task).number;
  for (const step of listCurrentMergeSteps(task)) {
    const key = resolveMergeStepKey(step);
    if (seen.has(key)) continue;
    seen.add(key);
    views.push({ ...step, key, done: done.has(key), round, due: isCurrentDue(task, step) });
  }
  return views;
}

export function listOpenMergeSteps(task: MergeStepSource, when: MergeStepTiming) {
  return listMergeSteps(task).filter((step) => step.when === when && !step.done);
}

export function listDuePostMergeSteps(task: MergeStepSource) {
  return listOpenMergeSteps(task, 'post_merge').filter((step) => step.due);
}

export function listCarriedMergeSteps(task: MergeStepSource): CarriedMergeStep[] {
  return listMergeSteps(task)
    .filter((step) => !step.done && (step.when === 'post_merge' || step.due))
    .map((step) => ({ ...toMergeStep(step), round: step.round, done: false }));
}
