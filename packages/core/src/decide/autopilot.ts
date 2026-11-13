import { Option } from 'effect';
import { isAutopilotDoneSeeable } from '../autopilot/done.ts';
import { resolveLessonLimit } from '../autopilot/lessons.ts';
import {
  isUrgentTask,
  isWatchdogTask,
  resolveAutopilotFacts,
  resolveAutopilotLimits,
  resolveAutopilotSuggestionLimit,
} from '../autopilot/limits.ts';
import { selectJudgedGateKind } from '../autopilot/prompt.ts';
import {
  AUTOPILOT_JUDGMENT_LIMITS,
  AUTOPILOT_LIMITS,
  AUTOPILOT_SCORED_KINDS,
  type AutopilotFacts,
  type AutopilotGateKind,
  type AutopilotLimit,
  type AutopilotVerdict,
} from '../autopilot/schema.ts';
import type { CommandOf } from '../commands/index.ts';
import {
  type AutopilotDue,
  DomainError,
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
import { answerGateForYou, approveReviewAhead } from './gates.ts';
import { hasOpenPreMergeSteps } from './merge-steps.ts';
import { startMerge } from './pull-requests.ts';
import { settleSuggestionForYou } from './suggestions.ts';

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

export function applyAutopilotMerge(decider: Decider, gate: Gate) {
  askAutopilot(decider, gate);
  scheduleAutopilot(
    decider,
    gate,
    isWatched(decider, decider.task(gate.taskId)) ? resolveNextCheck(decider) : null
  );
}

interface Refusal {
  reason: string;
  teaches: boolean;
  guesses: boolean;
}

function forward(decider: Decider, gateId: string, { reason, teaches }: Refusal) {
  const gate = decider.state.gates[gateId];
  if (!gate || (gate.autopilotHeld === reason && gate.autopilotJudging !== true)) return false;
  decider.emit({ type: 'autopilot.forwarded', gateId, reason, teaches });
  return true;
}

function requestJudgment(decider: Decider, gateId: string) {
  const gate = decider.state.gates[gateId];
  if (!gate || gate.autopilotJudging === true) return;
  decider.emit({ type: 'autopilot.judging', gateId });
  decider.run({ kind: 'autopilot.judge', taskId: gate.taskId, gateId, shadow: false });
}

function isScoredGate(kind: AutopilotGateKind) {
  return (AUTOPILOT_SCORED_KINDS as readonly string[]).includes(kind);
}

function requestShadowJudgment(decider: Decider, gate: Gate, kind: AutopilotGateKind) {
  if (!isScoredGate(kind) || gate.autopilotGuess !== undefined) return;
  decider.run({ kind: 'autopilot.judge', taskId: gate.taskId, gateId: gate.id, shadow: true });
}

function recordGuess(decider: Decider, gate: Gate, kind: AutopilotGateKind, verdict: AutopilotVerdict) {
  if (!isScoredGate(kind) || gate.autopilotGuess !== undefined) return;
  decider.emit({ type: 'autopilot.guessed', gateId: gate.id, verdict });
}

function resolveRefusal(decider: Decider, gate: Gate, kind: AutopilotGateKind): Refusal | null {
  const task = decider.task(gate.taskId);
  const { act } = resolveLimits(
    decider.state,
    task,
    kind,
    gate.openedAt,
    decider.context.now,
    gate.escalation !== undefined
  ).limits;
  const block = kind === 'merge' ? resolveMergeRefusal(decider, task) : null;
  const guesses = block === null;
  if (!act.allowed) return { reason: act.reason, teaches: !act.setting, guesses };
  const lesson = resolveLessonLimit(decider.state, kind);
  if (!lesson.allowed) return { reason: lesson.reason, teaches: true, guesses };
  return block === null ? null : { reason: MERGE_BLOCK_TEXT[block], teaches: false, guesses };
}

export function askAutopilot(decider: Decider, gate: Gate) {
  if (!resolveAutopilotPolicy(decider.state.settings).enabled) return;
  const kind = Option.getOrNull(selectJudgedGateKind(gate));
  if (!kind) return;
  if (kind === 'proposal' && !isWatchdogTask(decider.task(gate.taskId))) return;
  const refusal = resolveRefusal(decider, gate, kind);
  if (refusal === null) {
    requestJudgment(decider, gate.id);
    return;
  }
  const firstTime = gate.autopilotHeld === undefined;
  if (forward(decider, gate.id, refusal) && firstTime && refusal.guesses)
    requestShadowJudgment(decider, gate, kind);
}

const NOT_SURE = 'Autopilot was not sure what to answer, so the question waits for you.';

const NO_REASON = 'Autopilot judged it clear and small enough to do for you.';

function selectJudgedGate(decider: Decider, command: CommandOf<'autopilot.judgment'>) {
  const gate = decider.state.gates[command.gateId];
  const task = decider.state.tasks[command.taskId];
  if (!gate || !task || gate.taskId !== task.id || gate.status !== 'open') return null;
  if (command.shadow === (gate.autopilotJudging === true) || isTaskClosed(task)) return null;
  const kind = Option.getOrNull(selectJudgedGateKind(gate));
  return kind ? { gate, kind } : null;
}

function clip(text: string | null, limit: number) {
  return (text ?? '').trim().slice(0, limit);
}

export function applyAutopilotJudgment(decider: Decider, command: CommandOf<'autopilot.judgment'>) {
  const found = selectJudgedGate(decider, command);
  if (!found) return;
  const { gate, kind } = found;
  if (command.shadow) {
    recordGuess(decider, gate, kind, command.verdict);
    return;
  }
  const reason = clip(command.reason, AUTOPILOT_JUDGMENT_LIMITS.reason);
  const refusal = resolveAutopilotPolicy(decider.state.settings).enabled
    ? resolveRefusal(decider, gate, kind)
    : { reason: 'Autopilot is off.', teaches: false, guesses: true };
  if (refusal !== null) {
    forward(decider, gate.id, refusal);
    if (refusal.guesses) recordGuess(decider, gate, kind, command.verdict);
    return;
  }
  if (command.verdict === 'forward') {
    recordGuess(decider, gate, kind, 'forward');
    forward(decider, gate.id, {
      reason: reason || 'Autopilot judged this needs you.',
      teaches: true,
      guesses: true,
    });
    return;
  }
  const why = reason || NO_REASON;
  switch (kind) {
    case 'plan':
    case 'proposal':
      answerGateForYou(decider, gate, 'approve', null, why);
      return;
    case 'review':
      approveReviewAhead(decider, gate, why);
      return;
    case 'merge':
      mergeForYou(decider, gate, why);
      return;
    case 'question': {
      const reply = clip(command.reply, AUTOPILOT_JUDGMENT_LIMITS.reply);
      if (reply) answerGateForYou(decider, gate, 'reply', reply, why);
      else forward(decider, gate.id, { reason: NOT_SURE, teaches: true, guesses: true });
      return;
    }
  }
}

function selectSuggestion(decider: Decider, taskId: string, suggestionId: string) {
  const task = decider.state.tasks[taskId];
  const suggestion = task?.suggestions?.find((candidate) => candidate.id === suggestionId);
  if (!task || !suggestion || suggestion.status !== 'open') return null;
  return { task, suggestion };
}

export function weighSuggestion(decider: Decider, taskId: string, suggestionId: string) {
  const found = selectSuggestion(decider, taskId, suggestionId);
  if (!found) return;
  const policy = resolveAutopilotPolicy(decider.state.settings);
  if (!resolveAutopilotSuggestionLimit(policy, found.suggestion).allowed) return;
  decider.run({ kind: 'autopilot.weigh', taskId, suggestionId });
}

const SUGGESTION_REASON: Record<'accept' | 'dismiss', string> = {
  accept: 'Autopilot judged it clearly worth doing.',
  dismiss: 'Autopilot judged it not worth doing.',
};

export function applyAutopilotWeighed(decider: Decider, command: CommandOf<'autopilot.weighed'>) {
  const found = selectSuggestion(decider, command.taskId, command.suggestionId);
  if (!found || command.verdict === 'forward') return;
  const policy = resolveAutopilotPolicy(decider.state.settings);
  if (!resolveAutopilotSuggestionLimit(policy, found.suggestion).allowed) return;
  const reason = clip(command.reason, AUTOPILOT_JUDGMENT_LIMITS.reason) || SUGGESTION_REASON[command.verdict];
  settleSuggestionForYou(decider, found.task, found.suggestion, command.verdict === 'accept', reason);
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
    requestJudgment(decider, gate.id);
    scheduleAutopilot(decider, gate, next);
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

export function markAutopilotSeen(decider: Decider, command: CommandOf<'autopilot.seen'>) {
  if (decider.context.onBehalf) {
    throw new DomainError({
      code: 'human_only',
      message: 'Only you mark what Autopilot did for you as seen.',
    });
  }
  const gateIds = [...new Set(command.gateIds)].filter((gateId) => {
    const gate = decider.state.gates[gateId];
    return gate !== undefined && isAutopilotDoneSeeable(gate);
  });
  if (gateIds.length > 0) decider.emit({ type: 'autopilot.seen', gateIds });
}
