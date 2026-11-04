import type { CommandOf } from '../commands/index.ts';
import {
  type AutoShipDue,
  type Gate,
  isTaskClosed,
  MINUTE_MS,
  resolveApprovalPath,
} from '../domain/index.ts';
import { type AutoShipRisk, resolveAutoShipPolicy, type Settings } from '../domain/settings.ts';
import type { Task } from '../domain/types.ts';
import type { ReviewFinding, ReviewRating } from '../report/types.ts';
import type { Decider } from './decider.ts';
import { hasOpenPreMergeSteps } from './merge-steps.ts';
import { startMerge } from './pull-requests.ts';

export type AutoShipDecision = { approve: true; reason: string } | { approve: false; reason: string };

const RISK_ORDER: Record<ReviewRating, number> = { low: 0, medium: 1, high: 2 };

function isRiskWithin(risk: ReviewRating, upTo: AutoShipRisk) {
  return upTo !== 'none' && RISK_ORDER[risk] <= RISK_ORDER[upTo];
}

function isUrgent(task: Task) {
  return task.priority === 'urgent';
}

function isRiskAllowed(settings: Settings, task: Task, risk: ReviewRating) {
  const policy = resolveAutoShipPolicy(settings);
  if (isRiskWithin(risk, policy.approveUpTo)) return true;
  return isUrgent(task) && isRiskWithin(risk, policy.urgentApproveUpTo);
}

export function isAutoShipCandidate(settings: Settings, task: Task) {
  const ratings = task.reviewRatings;
  if (!resolveAutoShipPolicy(settings).enabled || !ratings) return false;
  return ratings.confidence === 'high' && isRiskAllowed(settings, task, ratings.risk);
}

function isDismissed(task: Task, finding: ReviewFinding) {
  return (task.dismissedFindings ?? []).some(
    (dismissed) =>
      dismissed.file === finding.file &&
      dismissed.line === finding.line &&
      dismissed.message === finding.message
  );
}

export function isFindingFixedBeforeReview(settings: Settings, task: Task, finding: ReviewFinding) {
  if (isDismissed(task, finding)) return false;
  if (finding.severity === 'blocking') return true;
  if (finding.severity !== 'should_fix') return false;
  return task.approveAfterFix === true || isAutoShipCandidate(settings, task);
}

function describeApproval(task: Task, risk: ReviewRating) {
  return isUrgent(task) ? `High confidence, ${risk} risk, urgent.` : `High confidence, ${risk} risk.`;
}

export function resolveAutoShipDecision(
  settings: Settings,
  task: Task,
  escalated: boolean
): AutoShipDecision | null {
  const ratings = task.reviewRatings;
  if (!resolveAutoShipPolicy(settings).enabled) return null;
  if (escalated) return { approve: false, reason: 'The agents could not settle the review.' };
  if (!ratings) return { approve: false, reason: 'The reviewer did not rate the change.' };
  if (ratings.confidence !== 'high') {
    return { approve: false, reason: `The reviewer’s confidence is ${ratings.confidence}.` };
  }
  if (!isRiskAllowed(settings, task, ratings.risk)) {
    return { approve: false, reason: `The risk is ${ratings.risk}, above what Auto-ship approves.` };
  }
  return { approve: true, reason: describeApproval(task, ratings.risk) };
}

function resolveMergeRefusal(decider: Decider, task: Task) {
  if (!task.autoShipped) return 'You approved the review yourself.';
  if (hasOpenPreMergeSteps(decider, task)) return 'A pre-merge step is not ticked yet.';
  if (resolveApprovalPath(task, 'merge') !== 'merge') return 'Your edits are not pushed yet.';
  return null;
}

function isMergeAllowed(settings: Settings, task: Task) {
  const merge = resolveAutoShipPolicy(settings).merge;
  if (merge === 'approved') return true;
  return merge === 'low_risk' && task.reviewRatings?.risk === 'low';
}

function mergeForYou(decider: Decider, gate: Gate, reason: string) {
  decider.emit({
    type: 'gate.answered',
    gateId: gate.id,
    decision: 'approve',
    response: null,
    ahead: true,
    autoShip: reason,
  });
  decider.requestBriefing(gate.taskId);
  startMerge(decider, gate.taskId, gate.commit ?? null);
}

function scheduleAutoShip(decider: Decider, gate: Gate, due: AutoShipDue | null) {
  if ((gate.autoShipDue ?? null) === null && due === null) return;
  decider.emit({ type: 'auto_ship.scheduled', gateId: gate.id, due });
}

function resolveUrgentDue(decider: Decider, task: Task): AutoShipDue | null {
  const policy = resolveAutoShipPolicy(decider.state.settings);
  if (!policy.enabled || !isUrgent(task) || policy.urgent === 'wait') return null;
  return {
    at: decider.context.now + policy.urgentWaitMinutes * MINUTE_MS,
    action: policy.urgent === 'merge' ? 'merge' : 'escalate',
  };
}

export function applyAutoShipMerge(decider: Decider, gate: Gate) {
  const task = decider.task(gate.taskId);
  const settings = decider.state.settings;
  if (resolveAutoShipPolicy(settings).enabled && isMergeAllowed(settings, task)) {
    if (resolveMergeRefusal(decider, task) === null) {
      mergeForYou(decider, gate, task.autoShipped?.reason ?? '');
      return;
    }
  }
  scheduleAutoShip(decider, gate, resolveUrgentDue(decider, task));
}

function describeWait(minutes: number) {
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

function escalate(decider: Decider, task: Task, reason: string) {
  if (task.escalation) return;
  decider.emit({ type: 'task.escalated', taskId: task.id, reason });
}

function selectDueGate(decider: Decider, command: CommandOf<'auto_ship.fire'>) {
  const gate = decider.state.gates[command.gateId];
  const task = decider.state.tasks[command.taskId];
  if (!gate || !task || gate.taskId !== task.id || gate.type !== 'merge' || gate.status !== 'open')
    return null;
  if (gate.autoShipDue?.at !== command.dueAt || isTaskClosed(task)) return null;
  return { gate, task, due: gate.autoShipDue };
}

export function fireAutoShip(decider: Decider, command: CommandOf<'auto_ship.fire'>) {
  const found = selectDueGate(decider, command);
  if (!found) return;
  const { gate, task, due } = found;
  const policy = resolveAutoShipPolicy(decider.state.settings);
  if (!policy.enabled || !isUrgent(task)) {
    scheduleAutoShip(decider, gate, null);
    return;
  }
  const waited = `Urgent, and the merge waited ${describeWait(policy.urgentWaitMinutes)} for you.`;
  const refusal = resolveMergeRefusal(decider, task);
  if (due.action === 'merge' && refusal === null) {
    mergeForYou(decider, gate, waited);
    return;
  }
  escalate(decider, task, due.action === 'merge' ? `${waited} ${refusal}` : waited);
  const merges = policy.urgent === 'escalate_then_merge' && due.action === 'escalate' && refusal === null;
  scheduleAutoShip(
    decider,
    gate,
    merges ? { at: decider.context.now + policy.urgentWaitMinutes * MINUTE_MS, action: 'merge' } : null
  );
}
