import { Option } from 'effect';
import { DAY_MS, MINUTE_MS, resolveTaskShape } from '../domain/index.ts';
import type { FindingVerdict } from '../domain/schema.ts';
import type { Gate, GateDecision, Task } from '../domain/types.ts';
import { resolveLocalSlot } from '../presence/hours.ts';
import type { ReviewFinding, ReviewRating } from '../report/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { isHeldPlan, isUrgentTask, resolveAutopilotPresence } from './limits.ts';
import { isAutopilotPositive } from './model/learn.ts';
import { AUTOPILOT_HEAD_OF_KIND, type AutopilotModelGuess } from './model/schema.ts';
import {
  AUTOPILOT_DECISION_ANSWERS,
  AUTOPILOT_PROFILE_LIMITS,
  AUTOPILOT_SCORE_LIMITS,
  AUTOPILOT_SCORED_KINDS,
  type AutopilotAgreement,
  type AutopilotDecision,
  type AutopilotDecisionAnswer,
  type AutopilotDecisionFacts,
  type AutopilotFindingCounts,
  type AutopilotDecisionKind,
  type AutopilotGateKind,
  type AutopilotProfile,
  type AutopilotRate,
  type AutopilotScoredKind,
  type AutopilotTally,
  type AutopilotTrack,
  type AutopilotVerdict,
  EMPTY_AUTOPILOT_PROFILE,
} from './schema.ts';
import {
  isAutopilotAgreement,
  resolveAutopilotBaseRate,
  resolveAutopilotCombinedVerdict,
  resolveAutopilotLoss,
} from './score.ts';

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

const FINDING_COUNT: Record<ReviewFinding['severity'], keyof AutopilotFindingCounts> = {
  blocking: 'blocking',
  should_fix: 'shouldFix',
  optional: 'optional',
};

function countFindings(findings: readonly ReviewFinding[]): AutopilotFindingCounts {
  const counts: AutopilotFindingCounts = { blocking: 0, shouldFix: 0, optional: 0 };
  for (const finding of findings) counts[FINDING_COUNT[finding.severity]] += 1;
  return counts;
}

function resolveDecisionFacts(state: ShinsaState, draft: DecisionDraft, at: number): AutopilotDecisionFacts {
  const { task, gate } = draft;
  const presence = resolveAutopilotPresence(state, at);
  return {
    confidence: task.reviewRatings?.confidence ?? null,
    shape: resolveTaskShape(task),
    repoId: task.repoId,
    revisions: Math.max(0, (task.plan?.version ?? 1) - 1),
    findings: countFindings(task.findings),
    heldPlan: isHeldPlan(task),
    waitedMinutes: gate ? Math.max(0, Math.floor((at - gate.openedAt) / MINUTE_MS)) : null,
    active: presence.active,
    inHours: presence.inHours,
    hour: resolveLocalSlot(state.timeZone ?? 'UTC', at).hour,
  };
}

export function createAutopilotDecision(
  state: ShinsaState,
  draft: DecisionDraft,
  at: number
): AutopilotDecision {
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
    facts: resolveDecisionFacts(state, draft, at),
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

function resolveDecay(halfLife: number, elapsed: number) {
  return elapsed <= 0 ? 1 : 0.5 ** (elapsed / halfLife);
}

function decayAnswers(answers: AutopilotTally['recent'], factor: number) {
  return Object.fromEntries(
    Object.entries(answers).map(([answer, weight]) => [answer, (weight ?? 0) * factor])
  ) as AutopilotTally['recent'];
}

function countDecision(tallies: Map<string, AutopilotTally>, decision: AutopilotDecision) {
  const halfLife = AUTOPILOT_PROFILE_LIMITS.halfLifeDays * DAY_MS;
  for (const { projectId, risk } of listTallyScopes(decision)) {
    const key = resolveTallyKey(decision.kind, projectId, risk);
    const tally = tallies.get(key) ?? {
      key,
      kind: decision.kind,
      projectId,
      risk,
      total: 0,
      answers: {},
      recent: {},
      at: decision.at,
    };
    const recent = decayAnswers(tally.recent, resolveDecay(halfLife, decision.at - tally.at));
    tallies.set(key, {
      ...tally,
      total: tally.total + 1,
      answers: { ...tally.answers, [decision.answer]: (tally.answers[decision.answer] ?? 0) + 1 },
      recent: { ...recent, [decision.answer]: (recent[decision.answer] ?? 0) + 1 },
      at: Math.max(tally.at, decision.at),
    });
  }
}

export type AutopilotScoredDecision = AutopilotDecision & { modelGuess?: AutopilotModelGuess | null };

interface TrackJudgment {
  right: boolean;
  p: number;
}

function scoreTrack(
  agreement: AutopilotAgreement,
  judgment: TrackJudgment,
  positive: boolean,
  baseRight: boolean
): AutopilotAgreement {
  const factor = resolveDecay(AUTOPILOT_SCORE_LIMITS.halfLife, 1);
  return {
    scored: agreement.scored + 1,
    agreed: agreement.agreed + (judgment.right ? 1 : 0),
    weight: agreement.weight * factor + 1,
    agreedWeight: agreement.agreedWeight * factor + (judgment.right ? 1 : 0),
    baseWeight: agreement.baseWeight * factor + (baseRight ? 1 : 0),
    loss: agreement.loss * factor + resolveAutopilotLoss(judgment.p, positive),
  };
}

function judgeVerdict(verdict: AutopilotVerdict, decision: AutopilotDecision): TrackJudgment {
  return { right: isAutopilotAgreement(verdict, decision.answer), p: verdict === 'act' ? 1 : 0 };
}

function judgeChance(p: number, positive: boolean): TrackJudgment {
  return { right: p >= 0.5 === positive, p };
}

function listTrackJudgments(decision: AutopilotScoredDecision, base: TrackJudgment, positive: boolean) {
  const judgments: [AutopilotTrack, TrackJudgment][] = [['base', base]];
  const modelGuess = decision.modelGuess ?? null;
  if (modelGuess) judgments.push(['model', judgeChance(modelGuess.p, positive)]);
  if (decision.guess !== null) {
    judgments.push(['call', judgeVerdict(decision.guess, decision)]);
    const combined = resolveAutopilotCombinedVerdict(decision.guess, modelGuess);
    judgments.push(['combined', judgeVerdict(combined, decision)]);
  }
  return judgments;
}

function stepRate(rate: AutopilotRate, positive: boolean): AutopilotRate {
  const factor = resolveDecay(AUTOPILOT_SCORE_LIMITS.halfLife, 1);
  return {
    positive: rate.positive * factor + (positive ? 1 : 0),
    negative: rate.negative * factor + (positive ? 0 : 1),
  };
}

function scoreDecision(
  profile: Pick<AutopilotProfile, 'tracks' | 'rates'>,
  decision: AutopilotScoredDecision
): Pick<AutopilotProfile, 'tracks' | 'rates'> {
  const head = AUTOPILOT_HEAD_OF_KIND[decision.kind];
  if (!head) return profile;
  const positive = isAutopilotPositive(head, decision);
  const base = judgeChance(resolveAutopilotBaseRate(profile.rates[head]), positive);
  const tracks = { ...profile.tracks };
  for (const [track, judgment] of listTrackJudgments(decision, base, positive))
    tracks[track] = scoreTrack(tracks[track], judgment, positive, base.right);
  return { tracks, rates: { ...profile.rates, [head]: stepRate(profile.rates[head], positive) } };
}

export function recordAutopilotDecisions(
  profile: AutopilotProfile | undefined,
  decisions: readonly AutopilotScoredDecision[]
): AutopilotProfile {
  const current = profile ?? EMPTY_AUTOPILOT_PROFILE;
  const tallies = new Map(current.tallies.map((tally) => [tally.key, tally]));
  for (const decision of decisions) countDecision(tallies, decision);
  const scored = decisions.reduce(scoreDecision, { tracks: current.tracks, rates: current.rates });
  return {
    total: current.total + decisions.length,
    decisions: [
      ...current.decisions,
      ...decisions.map(({ modelGuess: _guess, ...decision }) => decision),
    ].slice(-AUTOPILOT_PROFILE_LIMITS.words),
    tracks: scored.tracks,
    rates: scored.rates,
    tallies: [...tallies.values()],
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

const STEERING_KINDS: readonly AutopilotDecisionKind[] = ['message', 'edit', 'request', 'priority', 'cancel'];

const KIND_NOUN: Record<AutopilotDecisionKind, string> = {
  plan: 'plans',
  question: 'agent questions',
  review: 'reviews',
  merge: 'merges',
  proposal: 'proposals for your OK',
  finding: 'review findings',
  suggestion: 'suggested tasks',
  message: 'messages to agents',
  priority: 'priority changes',
  cancel: 'cancelled tasks',
  request: 'tasks they filed',
  edit: 'their own code edits',
};

function describeRecentLean(tally: AutopilotTally) {
  const weights = AUTOPILOT_DECISION_ANSWERS.map((answer) => [answer, tally.recent[answer] ?? 0] as const);
  const sum = weights.reduce((total, [, weight]) => total + weight, 0);
  return weights
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([answer, weight]) => `${answer} ${Math.round((weight / sum) * 100)}%`)
    .join(', ');
}

function describeTally(tally: AutopilotTally) {
  const answers = AUTOPILOT_DECISION_ANSWERS.filter((answer) => (tally.answers[answer] ?? 0) > 0)
    .map((answer) => `${answer} ${tally.answers[answer]}`)
    .join(', ');
  return `${tally.total} decided: ${answers}; lately ${describeRecentLean(tally)}`;
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
  const own = listAutopilotKindLines(state, GATE_DECISION_KINDS[gate], context);
  const steering = listAutopilotKindLines(state, STEERING_KINDS, context);
  const steeringLines = steering.length > 0 ? ['How they steer their tasks:', ...steering] : [];
  return fitToBudget([...own, ...steeringLines]);
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
