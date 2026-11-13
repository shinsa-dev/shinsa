import type { FindingVerdict } from '../domain/schema.ts';
import type { Gate, GateDecision, Task } from '../domain/types.ts';
import type { ReviewRating } from '../report/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { isUrgentTask } from './limits.ts';
import {
  AUTOPILOT_PROFILE_LIMITS,
  type AutopilotDecision,
  type AutopilotDecisionAnswer,
  type AutopilotDecisionKind,
  type AutopilotProfile,
  type AutopilotTally,
  EMPTY_AUTOPILOT_PROFILE,
} from './schema.ts';

const GATE_KIND: Partial<Record<Gate['type'], AutopilotDecisionKind>> = {
  plan: 'plan',
  question: 'question',
  review: 'review',
  merge: 'merge',
  proposal: 'proposal',
};

const ANSWER: Record<GateDecision, AutopilotDecisionAnswer> = {
  approve: 'approved',
  revise: 'revised',
  reject: 'rejected',
  reply: 'replied',
};

const VERDICT_ANSWER: Record<FindingVerdict['verdict'], AutopilotDecisionAnswer> = {
  fix: 'fixed',
  dismiss: 'dismissed',
};

export interface DecisionDraft {
  task: Task;
  gate: Gate | null;
  kind: AutopilotDecisionKind;
  answer: AutopilotDecisionAnswer;
  note: string | null;
}

export interface GateDecisionInput {
  gate: Gate;
  decision: GateDecision;
  response: string | null;
  verdicts?: readonly FindingVerdict[];
}

function clipNote(note: string | null) {
  const trimmed = (note ?? '').trim();
  if (!trimmed) return null;
  const limit = AUTOPILOT_PROFILE_LIMITS.note;
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

export function listGateDecisionDrafts(task: Task, input: GateDecisionInput): DecisionDraft[] {
  const kind = GATE_KIND[input.gate.type];
  if (!kind) return [];
  const answered: DecisionDraft = {
    task,
    gate: input.gate,
    kind,
    answer: ANSWER[input.decision],
    note: input.response,
  };
  const findings = (input.verdicts ?? []).map((verdict): DecisionDraft => ({
    task,
    gate: input.gate,
    kind: 'finding',
    answer: VERDICT_ANSWER[verdict.verdict],
    note: verdict.note,
  }));
  return [answered, ...findings];
}

function resolveDecisionScope(task: Task): AutopilotDecision['scope'] {
  const document = task.plan?.document;
  return document ? { phases: document.phases.length, files: document.files.length } : null;
}

export function createAutopilotDecision(draft: DecisionDraft, at: number): AutopilotDecision {
  const { task, gate } = draft;
  return {
    at,
    taskId: task.id,
    gateId: gate?.id ?? null,
    kind: draft.kind,
    answer: draft.answer,
    projectId: task.projectId ?? null,
    risk: task.reviewRatings?.risk ?? null,
    scope: resolveDecisionScope(task),
    urgent: isUrgentTask(task),
    watchdog: task.createdBy?.kind === 'watchdog',
    touched: gate?.autopilotHeld !== undefined,
    note: clipNote(draft.note),
  };
}

function resolveTallyKey(kind: AutopilotDecisionKind, projectId: string | null, risk: ReviewRating | null) {
  return [kind, projectId ?? '', risk ?? ''].join('|');
}

function listTallyScopes(decision: AutopilotDecision) {
  const scopes: { projectId: string | null; risk: ReviewRating | null }[] = [{ projectId: null, risk: null }];
  if (decision.projectId) scopes.push({ projectId: decision.projectId, risk: null });
  if (decision.risk) scopes.push({ projectId: null, risk: decision.risk });
  return scopes;
}

function countDecision(tallies: Map<string, AutopilotTally>, decision: AutopilotDecision) {
  for (const { projectId, risk } of listTallyScopes(decision)) {
    const key = resolveTallyKey(decision.kind, projectId, risk);
    const tally = tallies.get(key) ?? { key, kind: decision.kind, projectId, risk, total: 0, answers: {} };
    tallies.delete(key);
    tallies.set(key, {
      ...tally,
      total: tally.total + 1,
      answers: { ...tally.answers, [decision.answer]: (tally.answers[decision.answer] ?? 0) + 1 },
    });
  }
}

export function recordAutopilotDecisions(
  profile: AutopilotProfile | undefined,
  decisions: readonly AutopilotDecision[]
): AutopilotProfile {
  const current = profile ?? EMPTY_AUTOPILOT_PROFILE;
  const tallies = new Map(current.tallies.map((tally) => [tally.key, tally]));
  for (const decision of decisions) countDecision(tallies, decision);
  return {
    total: current.total + decisions.length,
    decisions: [...current.decisions, ...decisions].slice(-AUTOPILOT_PROFILE_LIMITS.kept),
    tallies: [...tallies.values()].slice(-AUTOPILOT_PROFILE_LIMITS.tallies),
  };
}

export function listAutopilotTallies(
  state: Pick<ShinsaState, 'autopilotProfile'>,
  kind: AutopilotDecisionKind
): AutopilotTally[] {
  return (state.autopilotProfile ?? EMPTY_AUTOPILOT_PROFILE).tallies.filter((tally) => tally.kind === kind);
}
