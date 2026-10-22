import { type Gate, listWaitsOn, type ShinsaState, type Task } from '@shinsa/core';
import { capitalise, formatCount } from '@/lib/format/count.ts';
import { describeWaitsOn } from './roadmap.ts';
import { selectLeadGate } from './task-status.ts';

function resolveGateNow(task: Task, gate: Gate) {
  if (gate.purpose !== 'decision') return gate.title;
  switch (gate.kind) {
    case 'spec': {
      const phases = task.spec?.document?.plan.length ?? 0;
      return phases === 0 ? 'Plan to approve' : `${formatCount(phases, 'phase', 'phases')} to approve`;
    }
    case 'review':
      return task.report?.headline ?? 'Checks passed, agent review clean';
    case 'merge':
      return task.pullRequest ? `PR #${task.pullRequest.number} is clean` : 'Clean and ready to merge';
    case 'question':
      return gate.title;
  }
}

function resolveActivePhase(task: Task) {
  const index = task.phases.findIndex((phase) => phase.status === 'active');
  return task.spec?.document?.plan[index]?.title ?? null;
}

export function resolveTaskNow(state: ShinsaState, task: Task): string {
  const gate = selectLeadGate(state, task.id);
  if (gate) return resolveGateNow(task, gate);

  const waitsOn = listWaitsOn(state, task);
  if (waitsOn.length > 0) return describeWaitsOn(waitsOn);

  const phase = task.stage === 'building' ? resolveActivePhase(task) : null;
  if (phase) return phase;
  if (task.stage === 'merged' && task.pullRequest) return `PR #${task.pullRequest.number} merged`;
  return capitalise(task.stageReason);
}
