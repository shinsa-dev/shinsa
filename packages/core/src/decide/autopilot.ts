import type { CommandOf } from '../commands/index.ts';
import {
  type AutopilotDue,
  type EscalationHandoff,
  type Gate,
  HOUR_MS,
  type MergeBlock,
  isTaskClosed,
  MINUTE_MS,
  resolveApprovalPath,
} from '../domain/index.ts';
import {
  type AutopilotPolicy,
  type AutopilotRisk,
  resolveAutopilotPolicy,
  type Settings,
} from '../domain/settings.ts';
import type { Task } from '../domain/types.ts';
import type { ReviewFinding, ReviewRating } from '../report/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { hasOpenPreMergeSteps } from './merge-steps.ts';
import { startMerge } from './pull-requests.ts';

export type AutopilotDecision = { approve: true; reason: string } | { approve: false; reason: string };

const RISK_ORDER: Record<ReviewRating, number> = { low: 0, medium: 1, high: 2 };

function isRiskWithin(risk: ReviewRating, upTo: AutopilotRisk) {
  return upTo !== 'none' && RISK_ORDER[risk] <= RISK_ORDER[upTo];
}

function isUrgent(task: Task) {
  return task.priority === 'urgent' && task.priorityOnBehalf !== true;
}

function isRiskAllowed(settings: Settings, task: Task, risk: ReviewRating) {
  const policy = resolveAutopilotPolicy(settings);
  if (isRiskWithin(risk, policy.approveUpTo)) return true;
  return isUrgent(task) && isRiskWithin(risk, policy.urgentApproveUpTo);
}

export function isUsageLimitExempt(settings: Settings, task: Task) {
  const policy = resolveAutopilotPolicy(settings);
  return policy.enabled && policy.ignoreUsageLimits && isUrgent(task);
}

function isAutopilotCandidate(settings: Settings, task: Task) {
  const ratings = task.reviewRatings;
  if (!resolveAutopilotPolicy(settings).enabled || !ratings) return false;
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
  return task.approveAfterFix === true || isAutopilotCandidate(settings, task);
}

function describeApproval(task: Task, risk: ReviewRating) {
  return isUrgent(task) ? `High confidence, ${risk} risk, urgent.` : `High confidence, ${risk} risk.`;
}

export function resolveAutopilotDecision(
  settings: Settings,
  task: Task,
  escalated: boolean
): AutopilotDecision | null {
  const ratings = task.reviewRatings;
  if (!resolveAutopilotPolicy(settings).enabled) return null;
  if (escalated) return { approve: false, reason: 'The agents could not settle the review.' };
  if (!ratings) return { approve: false, reason: 'The reviewer did not rate the change.' };
  if (ratings.confidence !== 'high') {
    return { approve: false, reason: `The reviewer’s confidence is ${ratings.confidence}.` };
  }
  if (!isRiskAllowed(settings, task, ratings.risk)) {
    return { approve: false, reason: `The risk is ${ratings.risk}, above what Autopilot approves.` };
  }
  return { approve: true, reason: describeApproval(task, ratings.risk) };
}

const MERGE_BLOCK_TEXT: Record<MergeBlock, string> = {
  self_approved: 'You approved the review yourself.',
  pre_merge_steps: 'A pre-merge step is not ticked yet.',
  edits_not_pushed: 'Your edits are not pushed yet.',
};

function resolveMergeRefusal(decider: Decider, task: Task): MergeBlock | null {
  if (!task.autopiloted) return 'self_approved';
  if (hasOpenPreMergeSteps(decider, task)) return 'pre_merge_steps';
  if (resolveApprovalPath(task, 'merge') !== 'merge') return 'edits_not_pushed';
  return null;
}

function isMergeAllowed(settings: Settings, task: Task) {
  const merge = resolveAutopilotPolicy(settings).merge;
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
    autopilot: reason,
  });
  decider.requestBriefing(gate.taskId);
  startMerge(decider, gate.taskId, gate.commit ?? null);
}

function scheduleAutopilot(decider: Decider, gate: Gate, due: AutopilotDue | null) {
  if ((gate.autopilotDue ?? null) === null && due === null) return;
  decider.emit({ type: 'autopilot.scheduled', gateId: gate.id, due });
}

function resolveUrgentDue(decider: Decider, task: Task): AutopilotDue | null {
  const policy = resolveAutopilotPolicy(decider.state.settings);
  if (!policy.enabled || !isUrgent(task) || policy.urgent === 'wait') return null;
  return {
    at: decider.context.now + policy.urgentWaitMinutes * MINUTE_MS,
    action: policy.urgent === 'merge' ? 'merge' : 'escalate',
  };
}

export function syncAutopilotDeadlines(decider: Decider, taskId?: string) {
  for (const gate of listOpenGates(decider.state, taskId)) {
    if (gate.type !== 'merge') continue;
    const due = resolveUrgentDue(decider, decider.task(gate.taskId));
    if (due === null) scheduleAutopilot(decider, gate, null);
    else if (!gate.autopilotDue) scheduleAutopilot(decider, gate, due);
  }
}

export function applyAutopilotMerge(decider: Decider, gate: Gate) {
  const task = decider.task(gate.taskId);
  const settings = decider.state.settings;
  if (resolveAutopilotPolicy(settings).enabled && isMergeAllowed(settings, task)) {
    if (resolveMergeRefusal(decider, task) === null) {
      mergeForYou(decider, gate, task.autopiloted?.reason ?? '');
      return;
    }
  }
  scheduleAutopilot(decider, gate, resolveUrgentDue(decider, task));
}

function describeWait(minutes: number) {
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

function resolveOwnerActiveAt(state: ShinsaState) {
  const hours = Object.keys(state.presence).map(Number);
  return hours.length === 0 ? null : Math.max(...hours) * HOUR_MS;
}

function resolveFinder(state: ShinsaState, task: Task) {
  if (task.createdBy?.kind !== 'watchdog') return null;
  return {
    server: task.sourceReport?.server ?? null,
    shippedTaskTitle: state.tasks[task.createdBy.taskId]?.title ?? null,
  };
}

type HandoffTiming = Pick<EscalationHandoff, 'waitedMinutes' | 'mergesAt' | 'blockedBy'>;

export function resolveEscalationHandoff(
  state: ShinsaState,
  task: Task,
  timing: HandoffTiming
): EscalationHandoff {
  return {
    ...timing,
    ownerActiveAt: resolveOwnerActiveAt(state),
    foundBy: resolveFinder(state, task),
    ratings: task.reviewRatings ?? null,
  };
}

function escalate(decider: Decider, task: Task, reason: string, timing: HandoffTiming) {
  if (task.escalation) return;
  decider.emit({
    type: 'task.escalated',
    taskId: task.id,
    reason,
    handoff: resolveEscalationHandoff(decider.state, task, timing),
  });
}

function resolveUrgentAction(urgent: AutopilotPolicy['urgent'], due: AutopilotDue['action']) {
  if (urgent === 'wait') return null;
  return urgent === 'escalate_then_merge' ? due : urgent;
}

function selectDueGate(decider: Decider, command: CommandOf<'autopilot.fire'>) {
  const gate = decider.state.gates[command.gateId];
  const task = decider.state.tasks[command.taskId];
  if (!gate || !task || gate.taskId !== task.id || gate.type !== 'merge' || gate.status !== 'open')
    return null;
  if (gate.autopilotDue?.at !== command.dueAt || isTaskClosed(task)) return null;
  return { gate, task, due: gate.autopilotDue };
}

export function fireAutopilot(decider: Decider, command: CommandOf<'autopilot.fire'>) {
  const found = selectDueGate(decider, command);
  if (!found) return;
  const { gate, task, due } = found;
  const policy = resolveAutopilotPolicy(decider.state.settings);
  const action = resolveUrgentAction(policy.urgent, due.action);
  if (!policy.enabled || !isUrgent(task) || action === null) {
    scheduleAutopilot(decider, gate, null);
    return;
  }
  const waited = `Urgent, and the merge waited ${describeWait(policy.urgentWaitMinutes)} for you.`;
  const refusal = resolveMergeRefusal(decider, task);
  if (action === 'merge' && refusal === null) {
    mergeForYou(decider, gate, waited);
    return;
  }
  const merges = policy.urgent === 'escalate_then_merge' && action === 'escalate' && refusal === null;
  const next: AutopilotDue | null = merges
    ? { at: decider.context.now + policy.urgentWaitMinutes * MINUTE_MS, action: 'merge' }
    : null;
  const blockedBy = action === 'merge' ? refusal : null;
  escalate(decider, task, blockedBy ? `${waited} ${MERGE_BLOCK_TEXT[blockedBy]}` : waited, {
    waitedMinutes: policy.urgentWaitMinutes,
    mergesAt: next?.at ?? null,
    blockedBy,
  });
  scheduleAutopilot(decider, gate, next);
}
