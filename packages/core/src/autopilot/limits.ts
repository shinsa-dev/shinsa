import { Option } from 'effect';
import { type Gate, HOUR_MS, MINUTE_MS, hasStep } from '../domain/index.ts';
import { type AutopilotGate, type AutopilotLevel, type AutopilotPolicy } from '../domain/settings.ts';
import type { Task, TaskSuggestion } from '../domain/types.ts';
import { isActiveAt, resolveActiveHours, resolveLocalSlot } from '../presence/hours.ts';
import type { ReviewRating } from '../report/types.ts';
import type { ShinsaState } from '../state/project.ts';
import {
  AUTOPILOT_CEILINGS,
  AUTOPILOT_JUDGED_FAILURE_CAUSES,
  AUTOPILOT_LIMITS,
  type AutopilotFacts,
  type AutopilotGateKind,
  type AutopilotLimit,
  type AutopilotLimits,
  type AutopilotOpenedFacts,
  type AutopilotPresence,
  type AutopilotReadinessKind,
  type AutopilotScope,
  AUTOPILOT_READINESS_KINDS,
} from './schema.ts';
import { isAutopilotKindReady } from './score.ts';

const RISK_ORDER: Record<ReviewRating, number> = { low: 0, medium: 1, high: 2 };

const GATE_SETTING: Record<Exclude<AutopilotGateKind, 'merge' | 'proposal'>, AutopilotGate> = {
  plan: 'plans',
  question: 'questions',
  review: 'reviews',
  failure: 'failures',
};

const ALLOWED: AutopilotLimit = { allowed: true };

function refuse(reason: string): AutopilotLimit {
  return { allowed: false, reason, setting: false };
}

function refuseBySetting(reason: string): AutopilotLimit {
  return { allowed: false, reason, setting: true };
}

export function isWatchdogTask(task: Task) {
  return task.createdBy?.kind === 'watchdog';
}

export function isAutopilotJudgedFailure(gate: Gate) {
  if (gate.type !== 'failure') return false;
  return gate.cause === undefined || AUTOPILOT_JUDGED_FAILURE_CAUSES.includes(gate.cause);
}

export function isUrgentTask(task: Task) {
  return task.priority === 'urgent' && task.priorityOnBehalf !== true;
}

function resolveLastSeenAt(state: ShinsaState, now: number) {
  const hours = Object.keys(state.presence)
    .map(Number)
    .filter((hour) => hour * HOUR_MS <= now);
  if (hours.length === 0) return null;
  return Math.min(now, (Math.max(...hours) + 1) * HOUR_MS);
}

export function resolveAutopilotOpenedFacts(state: ShinsaState, at: number): AutopilotOpenedFacts {
  const presence = resolveAutopilotPresence(state, at);
  return {
    active: presence.active,
    inHours: presence.inHours,
    hour: resolveLocalSlot(state.timeZone ?? 'UTC', at).hour,
  };
}

export function resolveAutopilotPresence(state: ShinsaState, now: number): AutopilotPresence {
  const hours = resolveActiveHours(state, now);
  const lastSeenAt = resolveLastSeenAt(state, now);
  const awayMinutes = lastSeenAt === null ? null : Math.floor((now - lastSeenAt) / MINUTE_MS);
  const active = awayMinutes !== null && awayMinutes <= AUTOPILOT_LIMITS.activeMinutes;
  return {
    inHours: Option.isNone(hours) ? null : isActiveAt(hours, now),
    active,
    awayMinutes: active ? 0 : awayMinutes,
  };
}

function resolveScope(task: Task): AutopilotScope | null {
  const document = task.plan?.document;
  return document ? { phases: document.phases.length, files: document.files.length } : null;
}

export function isHeldPlan(task: Task) {
  const document = task.plan?.document;
  return (
    hasStep(task, 'operate') ||
    task.planFirst ||
    Boolean(task.backlog) ||
    document?.approval === true ||
    (document?.split ?? []).length > 0
  );
}

function isReadinessKind(kind: AutopilotGateKind): kind is AutopilotGateKind & AutopilotReadinessKind {
  return (AUTOPILOT_READINESS_KINDS as readonly string[]).includes(kind);
}

export function resolveAutopilotFacts(
  state: ShinsaState,
  task: Task,
  gate: AutopilotGateKind,
  openedAt: Gate['openedAt'],
  now: number
): AutopilotFacts {
  const ratings = task.reviewRatings ?? null;
  return {
    gate,
    urgent: isUrgentTask(task),
    watchdog: isWatchdogTask(task),
    confidence: ratings?.confidence ?? null,
    risk: ratings?.risk ?? null,
    scope: resolveScope(task),
    heldPlan: isHeldPlan(task),
    escalatedReview: false,
    approvedByYou: !task.autopiloted,
    ready: isReadinessKind(gate) && isAutopilotKindReady(state, gate),
    waitedMinutes: Math.max(0, Math.floor((now - openedAt) / MINUTE_MS)),
    presence: resolveAutopilotPresence(state, now),
  };
}

function isWithin(risk: ReviewRating, ceiling: ReviewRating) {
  return RISK_ORDER[risk] <= RISK_ORDER[ceiling];
}

function isHigher(left: ReviewRating, right: ReviewRating) {
  return RISK_ORDER[left] > RISK_ORDER[right];
}

function hasBeenAwayLong(facts: AutopilotFacts) {
  const away = facts.presence.awayMinutes;
  if (facts.presence.active || away === null) return false;
  return Math.min(away, facts.waitedMinutes) >= AUTOPILOT_LIMITS.awayMinutes;
}

export function resolveAutopilotLevel(facts: AutopilotFacts, policy: AutopilotPolicy): AutopilotLevel {
  return policy.level === 'everything' && !facts.ready ? 'most' : policy.level;
}

function resolveGateSetting(facts: AutopilotFacts): AutopilotGate | null {
  if (facts.gate === 'merge') return null;
  if (facts.gate === 'proposal') return facts.watchdog ? 'watchdogTasks' : 'proposals';
  return GATE_SETTING[facts.gate];
}

function limitRatings(facts: AutopilotFacts, ceiling: ReviewRating): AutopilotLimit {
  if (facts.confidence === null || facts.risk === null)
    return refuse('The reviewer did not rate the change.');
  if (facts.confidence !== 'high') return refuse(`The reviewer’s confidence is ${facts.confidence}.`);
  if (!isWithin(facts.risk, ceiling)) {
    return refuse(`The risk is ${facts.risk}, above what Autopilot does on its own.`);
  }
  return ALLOWED;
}

function limitPlan(facts: AutopilotFacts, level: AutopilotLevel): AutopilotLimit {
  if (facts.heldPlan)
    return refuseBySetting('This plan asks for you: it runs an operation, splits or you asked to see it.');
  const scope = facts.scope;
  if (!scope) return refuse('The plan has no phases yet.');
  const ceiling = AUTOPILOT_CEILINGS[level].scope;
  if (scope.phases > ceiling.phases || scope.files > ceiling.files) {
    return refuse('The plan is larger than Autopilot approves on its own.');
  }
  return ALLOWED;
}

function limitProposal(facts: AutopilotFacts, level: AutopilotLevel): AutopilotLimit {
  if (!facts.watchdog && level !== 'everything') {
    return refuseBySetting('Below Everything, Autopilot gives your OK only on tasks a watchdog filed.');
  }
  if (facts.heldPlan) {
    return refuseBySetting('This asks for you: it runs an operation or you asked to see its plan.');
  }
  return ALLOWED;
}

function limitFailure(level: AutopilotLevel): AutopilotLimit {
  if (level !== 'everything') return refuseBySetting('Below Everything, failed steps wait for you.');
  return ALLOWED;
}

function limitReview(facts: AutopilotFacts, level: AutopilotLevel): AutopilotLimit {
  if (facts.escalatedReview) return refuseBySetting('The agents could not settle the review.');
  const ceiling = AUTOPILOT_CEILINGS[level];
  return limitRatings(facts, facts.urgent ? ceiling.urgentRisk : ceiling.risk);
}

function resolveMergeCeiling(facts: AutopilotFacts, policy: AutopilotPolicy): ReviewRating {
  const ceiling = AUTOPILOT_CEILINGS[resolveAutopilotLevel(facts, policy)];
  const base = policy.autoMerge === 'low_risk' ? 'low' : ceiling.risk;
  if (!facts.urgent || !hasBeenAwayLong(facts)) return base;
  return isHigher(ceiling.urgentRisk, base) ? ceiling.urgentRisk : base;
}

function limitMerge(facts: AutopilotFacts, policy: AutopilotPolicy): AutopilotLimit {
  if (policy.autoMerge === 'off') return refuseBySetting('Auto merge is off.');
  if (facts.approvedByYou) return refuseBySetting('You approved the review yourself.');
  return limitRatings(facts, resolveMergeCeiling(facts, policy));
}

function limitAct(facts: AutopilotFacts, policy: AutopilotPolicy): AutopilotLimit {
  if (!policy.enabled) return refuseBySetting('Autopilot is off.');
  const setting = resolveGateSetting(facts);
  if (setting !== null && !policy.gates.includes(setting)) {
    return refuseBySetting('Autopilot does not act on this kind of gate.');
  }
  const level = resolveAutopilotLevel(facts, policy);
  switch (facts.gate) {
    case 'plan':
      return limitPlan(facts, level);
    case 'question':
      return ALLOWED;
    case 'review':
      return limitReview(facts, level);
    case 'merge':
      return limitMerge(facts, policy);
    case 'proposal':
      return limitProposal(facts, level);
    case 'failure':
      return limitFailure(level);
  }
}

function limitEscalate(facts: AutopilotFacts, policy: AutopilotPolicy): AutopilotLimit {
  if (!policy.enabled || !policy.escalate) return refuse('Autopilot does not contact your team.');
  if (!facts.urgent) return refuse('Only urgent changes go to your team.');
  if (facts.risk !== 'high') return refuse('Only high risk changes go to your team.');
  if (facts.presence.active) return refuse('You are active, so it stays with you.');
  if (!hasBeenAwayLong(facts)) {
    return refuse(
      `It goes to your team only after you have been away ${AUTOPILOT_LIMITS.awayMinutes} minutes.`
    );
  }
  return ALLOWED;
}

export function resolveAutopilotLimits(facts: AutopilotFacts, policy: AutopilotPolicy): AutopilotLimits {
  return { act: limitAct(facts, policy), escalate: limitEscalate(facts, policy) };
}

export function resolveAutopilotFindingLimit(
  state: Pick<ShinsaState, 'autopilotProfile'>,
  policy: AutopilotPolicy
): AutopilotLimit {
  if (!policy.enabled) return refuseBySetting('Autopilot is off.');
  if (!policy.gates.includes('findings')) return refuseBySetting('Autopilot does not judge review findings.');
  if (policy.level !== 'everything')
    return refuseBySetting('Below Everything, review findings wait for you.');
  if (!isAutopilotKindReady(state, 'finding')) {
    return refuse('Autopilot does not know how you judge review findings well enough yet.');
  }
  return ALLOWED;
}

export function resolveAutopilotSuggestionLimit(
  policy: AutopilotPolicy,
  suggestion: TaskSuggestion
): AutopilotLimit {
  if (!policy.enabled) return refuseBySetting('Autopilot is off.');
  if (!policy.gates.includes('suggestions')) {
    return refuseBySetting('Autopilot does not act on suggested tasks.');
  }
  if (policy.level === 'ask_first') return refuseBySetting('Ask me first leaves suggested tasks to you.');
  if (suggestion.splitOff) return refuseBySetting('You split it off yourself, so it waits for you.');
  if (suggestion.stacksOnThis) {
    return refuse('It would ship in the same pull request as this task, so it waits for you.');
  }
  return ALLOWED;
}
