import { describeCount } from '../chat/text.ts';
import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  type Gate,
  type GateDecision,
  isSamePipeline,
  isTaskClosed,
  isTaskResting,
  resolveCurrentRound,
  resolveHandOverPipeline,
  resolveTaskPipeline,
  type Task,
} from '../domain/index.ts';
import {
  listDuePostMergeSteps,
  listMergeSteps,
  listOpenMergeSteps,
  type MergeStepView,
} from '../report/merge-steps.ts';
import { listChangedIds } from '../state/draft.ts';
import { listBundleAbove, listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';

function describeEarly(task: Task, step: MergeStepView) {
  if (step.when === 'pre_merge') {
    return 'This step was due before the merge.';
  }
  if (!task.pullRequest) return 'Tick this once the pull request merges.';
  return `Tick this once pull request #${task.pullRequest.number} merges.`;
}

function assertCanTick(task: Task, step: MergeStepView) {
  if (isTaskClosed(task)) throw new DomainError('task_settled', 'This task is finished.');
  if (step.due) return;
  throw new DomainError('merge_step_early', describeEarly(task, step));
}

export function tickMergeStep(decider: Decider, command: CommandOf<'merge_step.tick'>) {
  if (decider.context.onBehalf) {
    throw new DomainError(
      'human_only',
      'Only the human ticks a step around the merge, once they did it. Tell them it is waiting in Shinsa.'
    );
  }
  const task = decider.task(command.taskId);
  const step = listMergeSteps(task).find((candidate) => candidate.key === command.key);
  if (!step) {
    throw new DomainError('merge_step_not_found', 'This step is no longer there.');
  }
  assertCanTick(task, step);
  if (step.done === command.done) return;
  decider.emit({
    type: 'merge_step.ticked',
    taskId: task.id,
    key: step.key,
    title: step.title,
    done: command.done,
  });
}

export function assertMergeStepsDone(decider: Decider, gate: Gate, decision: GateDecision) {
  if (gate.type !== 'merge' || decision !== 'approve') return;
  const task = decider.task(gate.taskId);
  const open = listOpenMergeSteps(task, 'pre_merge');
  if (open.length > 0) {
    throw new DomainError(
      'merge_steps_open',
      `Tick the ${describeCount(open.length, 'pre-merge step')} first.`
    );
  }
  for (const above of listBundleAbove(decider.state, task)) {
    const steps = listOpenMergeSteps(above, 'pre_merge');
    if (steps.length === 0) continue;
    throw new DomainError(
      'merge_steps_open',
      `Tick the ${describeCount(steps.length, 'pre-merge step')} of “${above.title}” first: it merges with this bundle.`
    );
  }
}

export function assertNoMergeStepsLeft(task: Task) {
  const open = listDuePostMergeSteps(task);
  if (open.length === 0) return;
  throw new DomainError(
    'task_open',
    `${describeCount(open.length, 'post-merge step is', 'post-merge steps are')} left.`
  );
}

function resolveListedTimings(steps: readonly MergeStepView[], round: number) {
  return {
    before: steps.some((step) => step.when === 'pre_merge' && (step.round === round || step.due)),
    after: steps.some((step) => step.when === 'post_merge' && step.round === round),
  };
}

function hasMergeSteps(task: Task) {
  return task.phaseReports.length > 0 || (task.carriedMergeSteps ?? []).length > 0;
}

function syncPipeline(decider: Decider, task: Task, steps: readonly MergeStepView[], round: number) {
  if (task.stage === 'cancelled') return;
  const current = resolveTaskPipeline(task);
  const pipeline = resolveHandOverPipeline(current, resolveListedTimings(steps, round));
  if (isSamePipeline(pipeline, current)) return;
  decider.emit({
    type: 'task.reshaped',
    taskId: task.id,
    pipeline,
    by: 'shinsa',
    reason: 'The work report lists steps for you around the merge.',
  });
}

function describePostMergeGate(task: Task, open: readonly MergeStepView[]) {
  const number = task.pullRequest?.number;
  const merged = number ? `Pull request #${number} merged.` : 'The change merged.';
  return [
    `${merged} These steps are yours; tick each once you did it. The task is done once every step is ticked.`,
    '',
    ...open.map((step) => `- [ ] **${step.title}**: ${step.detail}`),
  ].join('\n');
}

function isPostMergeDue(task: Task, open: readonly MergeStepView[], round: number) {
  if (isTaskClosed(task)) return false;
  return open.some((step) => step.round !== round || isTaskResting(task));
}

function syncPostMergeGate(decider: Decider, task: Task, round: number, gates: readonly Gate[]) {
  const open = listDuePostMergeSteps(task);
  const due = isPostMergeDue(task, open, round);
  if (due && gates.length === 0) {
    decider.openGate(
      task.id,
      'post_merge',
      `${describeCount(open.length, 'post-merge step')} left`,
      describePostMergeGate(task, open)
    );
    return;
  }
  if (due) return;
  for (const gate of gates) decider.emit({ type: 'gate.withdrawn', gateId: gate.id });
}

export function syncMergeSteps(decider: Decider) {
  for (const id of listChangedIds(decider.state, 'tasks')) {
    const task = decider.state.tasks[id];
    if (!task || !hasMergeSteps(task)) continue;
    const round = resolveCurrentRound(task).number;
    syncPipeline(decider, task, listMergeSteps(task), round);
    const gates = listOpenGates(decider.state, id).filter((gate) => gate.type === 'post_merge');
    syncPostMergeGate(decider, decider.task(id), round, gates);
  }
}
