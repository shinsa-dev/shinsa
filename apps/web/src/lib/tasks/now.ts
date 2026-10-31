import {
  capitalise,
  type Gate,
  listWaitsOn,
  type ShinsaState,
  selectLeadGate,
  type Task,
} from '@shinsa/core';
import { formatCount, formatSteps } from '@/lib/format/count.ts';
import { countOpenSteps } from '@/lib/review/merge-steps.ts';
import { describeWaitsOn } from '@/lib/tasks/groups.ts';

export function resolveGateNow(task: Task, gate: Gate) {
  switch (gate.type) {
    case 'plan': {
      const phases = task.plan?.document?.phases.length ?? 0;
      return phases === 0 ? 'Plan to approve' : `${formatCount(phases, 'phase', 'phases')} to approve`;
    }
    case 'review':
      return task.report?.headline ?? 'Checks passed, agent review clean';
    case 'merge': {
      const open = countOpenSteps(task, 'pre_merge');
      if (open > 0) return `${formatSteps(open)} to do before the merge`;
      return task.pullRequest ? `PR #${task.pullRequest.number} is clean` : 'Clean and ready to merge';
    }
    case 'post_merge':
      return task.pullRequest ? `PR #${task.pullRequest.number} merged` : 'Merged';
    default:
      return gate.title;
  }
}

export function describeConflict(task: Task) {
  const { pullRequest } = task;
  if (task.stage !== 'shipping' || task.pushPending || pullRequest?.mergeable !== false) return null;
  return `PR #${pullRequest.number} conflicts with ${pullRequest.base ?? 'the base branch'}`;
}

function resolveActivePhase(task: Task) {
  const phases = task.plan?.document?.phases ?? [];
  const index = task.phases.findIndex((phase) => phase.status === 'active');
  const title = phases[index]?.title;
  if (!title) return null;
  return phases.length > 1 ? `Phase ${index + 1} of ${phases.length}: ${title}` : title;
}

export function resolveTaskNow(state: ShinsaState, task: Task): string {
  const gate = selectLeadGate(state, task);
  if (gate) return resolveGateNow(task, gate);

  const waitsOn = listWaitsOn(state, task);
  if (waitsOn.length > 0) return describeWaitsOn(waitsOn);

  const phase = task.stage === 'building' ? resolveActivePhase(task) : null;
  if (phase) return phase;
  if (task.stage === 'merged' && task.pullRequest) return `PR #${task.pullRequest.number} merged`;
  return describeConflict(task) ?? capitalise(task.stageReason);
}
