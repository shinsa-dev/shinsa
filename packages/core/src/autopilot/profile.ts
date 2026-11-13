import { Option } from 'effect';
import type { FindingVerdict } from '../domain/schema.ts';
import type { Gate, GateDecision, Task } from '../domain/types.ts';
import type { ReviewRating } from '../report/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { isUrgentTask } from './limits.ts';
import {
  AUTOPILOT_DECISION_ANSWERS,
  AUTOPILOT_PROFILE_LIMITS,
  AUTOPILOT_SCORED_KINDS,
  type AutopilotDecision,
  type AutopilotDecisionAnswer,
  type AutopilotDecisionKind,
  type AutopilotGateKind,
  type AutopilotProfile,
  type AutopilotScoredKind,
  type AutopilotTally,
  AUTOPILOT_SCORE_LIMITS,
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

function isScoredKind(kind: AutopilotDecisionKind): kind is AutopilotScoredKind {
  return (AUTOPILOT_SCORED_KINDS as readonly AutopilotDecisionKind[]).includes(kind);
}

function resolveDecisionGuess(draft: DecisionDraft) {
  return isScoredKind(draft.kind) ? (draft.gate?.autopilotGuess ?? null) : null;
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
    guess: resolveDecisionGuess(draft),
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
    scored: [...current.scored, ...decisions.filter((decision) => decision.guess !== null)].slice(
      -AUTOPILOT_SCORE_LIMITS.window
    ),
    tallies: [...tallies.values()].slice(-AUTOPILOT_PROFILE_LIMITS.tallies),
  };
}

export function listAutopilotTallies(
  state: Pick<ShinsaState, 'autopilotProfile'>,
  kind: AutopilotDecisionKind
): AutopilotTally[] {
  return (state.autopilotProfile ?? EMPTY_AUTOPILOT_PROFILE).tallies.filter((tally) => tally.kind === kind);
}

const GATE_DECISION_KINDS: Record<AutopilotGateKind, readonly AutopilotDecisionKind[]> = {
  plan: ['plan'],
  question: ['question'],
  review: ['review', 'finding'],
  merge: ['merge'],
  proposal: ['proposal'],
};

const KIND_NOUN: Record<AutopilotDecisionKind, string> = {
  plan: 'plans',
  question: 'agent questions',
  review: 'reviews',
  merge: 'merges',
  proposal: 'proposals for your OK',
  finding: 'review findings',
  suggestion: 'suggested tasks',
};

function describeTally(tally: AutopilotTally) {
  const answers = AUTOPILOT_DECISION_ANSWERS.filter((answer) => (tally.answers[answer] ?? 0) > 0)
    .map((answer) => `${answer} ${tally.answers[answer]}`)
    .join(', ');
  return `${tally.total} decided: ${answers}`;
}

function selectTally(
  tallies: readonly AutopilotTally[],
  kind: AutopilotDecisionKind,
  projectId: string | null,
  risk: ReviewRating | null
) {
  return Option.fromNullishOr(tallies.find((tally) => tally.key === resolveTallyKey(kind, projectId, risk)));
}

function listKindLines(
  profile: AutopilotProfile,
  kind: AutopilotDecisionKind,
  context: AutopilotProfileContext
) {
  const all = selectTally(profile.tallies, kind, null, null);
  if (Option.isNone(all)) return [];
  const lines = [`- All ${KIND_NOUN[kind]}: ${describeTally(all.value)}`];
  if (context.projectId) {
    const project = selectTally(profile.tallies, kind, context.projectId, null);
    if (Option.isSome(project)) lines.push(`- In this project: ${describeTally(project.value)}`);
  }
  if (context.risk) {
    const risk = selectTally(profile.tallies, kind, null, context.risk);
    if (Option.isSome(risk)) lines.push(`- At ${context.risk} risk: ${describeTally(risk.value)}`);
  }
  return lines;
}

function listNoteLines(profile: AutopilotProfile, kinds: readonly AutopilotDecisionKind[]) {
  return profile.decisions
    .filter((decision) => decision.note !== null && kinds.includes(decision.kind))
    .slice(-AUTOPILOT_PROFILE_LIMITS.notes)
    .reverse()
    .map((decision) => `- ${KIND_NOUN[decision.kind]}, ${decision.answer}: “${decision.note}”`);
}

function fitToBudget(lines: readonly string[]) {
  const fitted: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > AUTOPILOT_PROFILE_LIMITS.summary) break;
    fitted.push(line);
    used += line.length + 1;
  }
  return fitted;
}

export interface AutopilotProfileContext {
  projectId: string | null;
  risk: ReviewRating | null;
}

export function listAutopilotProfileLines(
  state: Pick<ShinsaState, 'autopilotProfile'>,
  gate: AutopilotGateKind,
  context: AutopilotProfileContext
): string[] {
  return listAutopilotKindLines(state, GATE_DECISION_KINDS[gate], context);
}

export function listAutopilotKindLines(
  state: Pick<ShinsaState, 'autopilotProfile'>,
  kinds: readonly AutopilotDecisionKind[],
  context: AutopilotProfileContext
): string[] {
  const profile = state.autopilotProfile ?? EMPTY_AUTOPILOT_PROFILE;
  const counts = kinds.flatMap((kind) => listKindLines(profile, kind, context));
  if (counts.length === 0) return [];
  const notes = listNoteLines(profile, kinds);
  return fitToBudget([...counts, ...(notes.length > 0 ? ['Their recent words:', ...notes] : [])]);
}
