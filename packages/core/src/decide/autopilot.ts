import { isUrgentTask, resolveAutopilotFacts, resolveAutopilotLimits } from '../autopilot/limits.ts';
import {
  AUTOPILOT_LIMITS,
  type AutopilotFacts,
  type AutopilotGateKind,
  type AutopilotLimit,
} from '../autopilot/schema.ts';
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
import { resolveAutopilotPolicy, type Settings } from '../domain/settings.ts';
import type { Task } from '../domain/types.ts';
import type { ReviewFinding } from '../report/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { hasOpenPreMergeSteps } from './merge-steps.ts';
import { startMerge } from './pull-requests.ts';

export type AutopilotDecision = { approve: true; reason: string } | { approve: false; reason: string };

function resolveLimits(
  state: ShinsaState,
  task: Task,
  gate: AutopilotGateKind,
  openedAt: number,
  now: number,
  escalatedReview = false
) {
  const facts = { ...resolveAutopilotFacts(state, task, gate, openedAt, now), escalatedReview };
  return { facts, limits: resolveAutopilotLimits(facts, resolveAutopilotPolicy(state.settings)) };
}

export function isUsageLimitExempt(settings: Settings, task: Task) {
  const policy = resolveAutopilotPolicy(settings);
  return policy.enabled && policy.ignoreUsageLimits && isUrgentTask(task);
}

function isDismissed(task: Task, finding: ReviewFinding) {
  return (task.dismissedFindings ?? []).some(
    (dismissed) =>
      dismissed.file === finding.file &&
      dismissed.line === finding.line &&
      dismissed.message === finding.message
  );
}

export function isFindingFixedBeforeReview(
  state: ShinsaState,
  now: number,
  task: Task,
  finding: ReviewFinding
) {
  if (isDismissed(task, finding)) return false;
  if (finding.severity === 'blocking') return true;
  if (finding.severity !== 'should_fix') return false;
  return task.approveAfterFix === true || resolveLimits(state, task, 'review', now, now).limits.act.allowed;
}

function describeApproval(task: Task) {
  const risk = task.reviewRatings?.risk ?? 'low';
  return isUrgentTask(task) ? `High confidence, ${risk} risk, urgent.` : `High confidence, ${risk} risk.`;
}

export function resolveAutopilotDecision(
  state: ShinsaState,
  now: number,
  task: Task,
  escalated: boolean
): AutopilotDecision | null {
  if (!resolveAutopilotPolicy(state.settings).enabled) return null;
  const { act } = resolveLimits(state, task, 'review', now, now, escalated).limits;
  return act.allowed
    ? { approve: true, reason: describeApproval(task) }
    : { approve: false, reason: act.reason };
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

function isWatched(decider: Decider, task: Task) {
  return resolveAutopilotPolicy(decider.state.settings).enabled && isUrgentTask(task);
}

function resolveNextCheck(decider: Decider): AutopilotDue {
  return { at: decider.context.now + AUTOPILOT_LIMITS.awayMinutes * MINUTE_MS };
}

export function syncAutopilotDeadlines(decider: Decider, taskId?: string) {
  for (const gate of listOpenGates(decider.state, taskId)) {
    if (gate.type !== 'merge') continue;
    if (!isWatched(decider, decider.task(gate.taskId))) scheduleAutopilot(decider, gate, null);
    else if (!gate.autopilotDue) scheduleAutopilot(decider, gate, resolveNextCheck(decider));
  }
}

function describeMinutes(minutes: number) {
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

function describeUrgentMerge(waitedMinutes: number) {
  return `Urgent, and you were away while the merge waited ${describeMinutes(waitedMinutes)}.`;
}

export function applyAutopilotMerge(decider: Decider, gate: Gate) {
  const task = decider.task(gate.taskId);
  const { act } = resolveLimits(decider.state, task, 'merge', gate.openedAt, decider.context.now).limits;
  if (act.allowed && resolveMergeRefusal(decider, task) === null) {
    mergeForYou(decider, gate, task.autopiloted?.reason ?? '');
    return;
  }
  scheduleAutopilot(decider, gate, isWatched(decider, task) ? resolveNextCheck(decider) : null);
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
  for (const contact of resolveAutopilotPolicy(decider.state.settings).contacts)
    decider.run({
      kind: 'slack.escalate',
      taskId: task.id,
      escalatedAt: decider.context.now,
      contact,
      part: 'message',
    });
}

function selectDueGate(decider: Decider, command: CommandOf<'autopilot.fire'>) {
  const gate = decider.state.gates[command.gateId];
  const task = decider.state.tasks[command.taskId];
  if (!gate || !task || gate.taskId !== task.id || gate.type !== 'merge' || gate.status !== 'open')
    return null;
  if (gate.autopilotDue?.at !== command.dueAt || isTaskClosed(task)) return null;
  return isWatched(decider, task) ? { gate, task } : null;
}

function describeAway(facts: AutopilotFacts) {
  return `Urgent, high risk, and you were away while the merge waited ${describeMinutes(facts.waitedMinutes)}.`;
}

function describeLimit(limit: AutopilotLimit) {
  return limit.allowed ? '' : limit.reason;
}

function reviseEscalation(decider: Decider, task: Task, reason: string, timing: HandoffTiming) {
  decider.emit({
    type: 'task.escalation_revised',
    taskId: task.id,
    reason,
    handoff: resolveEscalationHandoff(decider.state, task, timing),
  });
}

export function fireAutopilot(decider: Decider, command: CommandOf<'autopilot.fire'>) {
  const found = selectDueGate(decider, command);
  if (!found) return;
  const { gate, task } = found;
  const { facts, limits } = resolveLimits(decider.state, task, 'merge', gate.openedAt, decider.context.now);
  const refusal = resolveMergeRefusal(decider, task);
  const next = resolveNextCheck(decider);
  const mergeable = limits.act.allowed && refusal === null;
  if (limits.escalate.allowed && !task.escalation) {
    const reason = describeAway(facts);
    escalate(decider, task, refusal ? `${reason} ${MERGE_BLOCK_TEXT[refusal]}` : reason, {
      waitedMinutes: facts.waitedMinutes,
      mergesAt: mergeable ? next.at : null,
      blockedBy: refusal,
    });
    scheduleAutopilot(decider, gate, next);
    return;
  }
  if (mergeable) {
    mergeForYou(decider, gate, describeUrgentMerge(facts.waitedMinutes));
    return;
  }
  if (task.escalation && task.escalation.handoff.mergesAt !== null) {
    const why = refusal ? MERGE_BLOCK_TEXT[refusal] : describeLimit(limits.act);
    reviseEscalation(decider, task, `${describeAway(facts)} ${why}`, {
      waitedMinutes: facts.waitedMinutes,
      mergesAt: null,
      blockedBy: refusal,
    });
  }
  scheduleAutopilot(decider, gate, next);
}
