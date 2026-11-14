import type { AutopilotLevel } from '../domain/settings.ts';
import type { TaskShape } from '../domain/shapes.ts';
import type { ReviewRating } from '../report/types.ts';
import type { AutopilotModelGuess } from './model/schema.ts';
import type { AutopilotModelHead } from './model/schema.ts';

export type AutopilotGateKind = 'plan' | 'question' | 'review' | 'merge' | 'proposal';

export interface AutopilotDone {
  gateId: string;
  taskId: string;
  gate: AutopilotGateKind;
  title: string;
  reason: string;
  followUp: string | null;
  at: number;
}

export const AUTOPILOT_DONE_LIMIT = 50;

export interface AutopilotScope {
  phases: number;
  files: number;
}

export interface AutopilotPresence {
  inHours: boolean | null;
  active: boolean;
  awayMinutes: number | null;
}

export interface AutopilotFacts {
  gate: AutopilotGateKind;
  urgent: boolean;
  watchdog: boolean;
  confidence: ReviewRating | null;
  risk: ReviewRating | null;
  scope: AutopilotScope | null;
  heldPlan: boolean;
  escalatedReview: boolean;
  approvedByYou: boolean;
  waitedMinutes: number;
  presence: AutopilotPresence;
}

export type AutopilotLimit = { allowed: true } | { allowed: false; reason: string; setting: boolean };

export interface AutopilotLimits {
  act: AutopilotLimit;
  revise: AutopilotLimit;
  escalate: AutopilotLimit;
}

export interface AutopilotCeiling {
  risk: ReviewRating;
  urgentRisk: ReviewRating;
  scope: AutopilotScope;
}

export const AUTOPILOT_CEILINGS: Record<AutopilotLevel, AutopilotCeiling> = {
  ask_first: { risk: 'low', urgentRisk: 'low', scope: { phases: 2, files: 4 } },
  balanced: { risk: 'low', urgentRisk: 'medium', scope: { phases: 4, files: 10 } },
  most: { risk: 'medium', urgentRisk: 'high', scope: { phases: 6, files: 20 } },
};

export const AUTOPILOT_LIMITS = {
  activeMinutes: 30,
  awayMinutes: 60,
} as const;

export const AUTOPILOT_VERDICTS = ['act', 'revise', 'forward'] as const;

export type AutopilotVerdict = (typeof AUTOPILOT_VERDICTS)[number];

export const AUTOPILOT_SUGGESTION_VERDICTS = ['accept', 'dismiss', 'forward'] as const;

export type AutopilotSuggestionVerdict = (typeof AUTOPILOT_SUGGESTION_VERDICTS)[number];

export interface AutopilotJudgment {
  verdict: AutopilotVerdict;
  reason: string;
  reply: string | null;
}

export const AUTOPILOT_JUDGMENT_LIMITS = {
  reason: 240,
  reply: 2000,
  context: 1200,
} as const;

export const AUTOPILOT_FOLLOW_UP_GATES = [
  'plan',
  'review',
  'merge',
] as const satisfies readonly AutopilotGateKind[];

export type AutopilotFollowUpGate = (typeof AUTOPILOT_FOLLOW_UP_GATES)[number];

export const AUTOPILOT_FOLLOW_UP_LIMITS = {
  perGate: 2,
} as const;

export const AUTOPILOT_LESSON_KINDS = ['acted', 'revised', 'forwarded'] as const;

export type AutopilotLessonKind = (typeof AUTOPILOT_LESSON_KINDS)[number];

export const AUTOPILOT_LESSON_ANSWERS = ['approved', 'revised', 'rejected', 'replied'] as const;

export type AutopilotLessonAnswer = (typeof AUTOPILOT_LESSON_ANSWERS)[number];

export interface AutopilotLessonFacts {
  urgent: boolean;
  watchdog: boolean;
  confidence: ReviewRating | null;
  risk: ReviewRating | null;
  scope: AutopilotScope | null;
}

export interface AutopilotLesson {
  id: string;
  at: number;
  taskId: string;
  gateId: string;
  gate: AutopilotGateKind;
  kind: AutopilotLessonKind;
  answer: AutopilotLessonAnswer;
  reason: string;
  note: string | null;
  facts: AutopilotLessonFacts;
}

export const AUTOPILOT_LESSON_LIMITS = {
  kept: 50,
  prompt: 8,
  note: 280,
  window: 4,
  corrections: 2,
} as const;

export const AUTOPILOT_DECISION_KINDS = [
  'plan',
  'question',
  'review',
  'merge',
  'proposal',
  'finding',
  'suggestion',
  'message',
  'priority',
  'cancel',
  'request',
  'edit',
] as const;

export type AutopilotDecisionKind = (typeof AUTOPILOT_DECISION_KINDS)[number];

export const AUTOPILOT_DECISION_ANSWERS = [
  'approved',
  'revised',
  'rejected',
  'replied',
  'fixed',
  'dismissed',
  'accepted',
  'kept',
  'sent',
  'raised',
  'lowered',
  'cancelled',
  'filed',
  'edited',
] as const;

export type AutopilotDecisionAnswer = (typeof AUTOPILOT_DECISION_ANSWERS)[number];

export interface AutopilotFindingCounts {
  blocking: number;
  shouldFix: number;
  optional: number;
}

export interface AutopilotDecisionFacts {
  confidence: ReviewRating | null;
  shape: TaskShape;
  repoId: string | null;
  revisions: number;
  findings: AutopilotFindingCounts;
  heldPlan: boolean;
  waitedMinutes: number | null;
  active: boolean;
  inHours: boolean | null;
  hour: number;
}

export interface AutopilotDecision {
  at: number;
  taskId: string;
  gateId: string | null;
  kind: AutopilotDecisionKind;
  answer: AutopilotDecisionAnswer;
  projectId: string | null;
  risk: ReviewRating | null;
  scope: AutopilotScope | null;
  urgent: boolean;
  watchdog: boolean;
  touched: boolean;
  guess: AutopilotVerdict | null;
  note: string | null;
  facts: AutopilotDecisionFacts | null;
  estimate: AutopilotModelGuess | null;
}

export interface AutopilotOpenedFacts {
  active: boolean;
  inHours: boolean | null;
  hour: number;
}

export interface AutopilotTally {
  key: string;
  kind: AutopilotDecisionKind;
  projectId: string | null;
  risk: ReviewRating | null;
  total: number;
  answers: Partial<Record<AutopilotDecisionAnswer, number>>;
  recent: Partial<Record<AutopilotDecisionAnswer, number>>;
  at: number;
}

export const AUTOPILOT_TRACKS = ['model', 'call', 'combined', 'base'] as const;

export type AutopilotTrack = (typeof AUTOPILOT_TRACKS)[number];

export interface AutopilotAgreement {
  scored: number;
  agreed: number;
  weight: number;
  agreedWeight: number;
  baseWeight: number;
  loss: number;
}

export interface AutopilotTrackJudgment {
  track: AutopilotTrack;
  right: boolean;
  p: number;
}

export interface AutopilotJudgments {
  positive: boolean;
  judgments: AutopilotTrackJudgment[];
  rates: Record<AutopilotModelHead, AutopilotRate>;
}

export const AUTOPILOT_BENCHMARK_SCOPES = ['all', 'shared'] as const;

export type AutopilotBenchmarkScope = (typeof AUTOPILOT_BENCHMARK_SCOPES)[number];

export type AutopilotBenchmarkKind = AutopilotDecisionKind | 'total';

export interface AutopilotBenchmarkRow {
  kind: AutopilotBenchmarkKind;
  scope: AutopilotBenchmarkScope;
  track: AutopilotTrack;
  scored: number;
  agreed: number;
  agreement: number;
  loss: number;
}

export interface AutopilotBenchmark {
  decisions: number;
  judged: number;
  rows: AutopilotBenchmarkRow[];
}

export interface AutopilotRate {
  positive: number;
  negative: number;
}

export interface AutopilotProfile {
  total: number;
  decisions: AutopilotDecision[];
  tracks: Record<AutopilotTrack, AutopilotAgreement>;
  rates: Record<AutopilotModelHead, AutopilotRate>;
  tallies: AutopilotTally[];
}

export const AUTOPILOT_PROFILE_LIMITS = {
  words: 200,
  note: 280,
  notes: 3,
  summary: 1200,
  halfLifeDays: 30,
} as const;

const EMPTY_AUTOPILOT_AGREEMENT: AutopilotAgreement = {
  scored: 0,
  agreed: 0,
  weight: 0,
  agreedWeight: 0,
  baseWeight: 0,
  loss: 0,
};

const EMPTY_AUTOPILOT_RATE: AutopilotRate = { positive: 0, negative: 0 };

export const EMPTY_AUTOPILOT_PROFILE: AutopilotProfile = {
  total: 0,
  decisions: [],
  tracks: {
    model: EMPTY_AUTOPILOT_AGREEMENT,
    call: EMPTY_AUTOPILOT_AGREEMENT,
    combined: EMPTY_AUTOPILOT_AGREEMENT,
    base: EMPTY_AUTOPILOT_AGREEMENT,
  },
  rates: { gate: EMPTY_AUTOPILOT_RATE, finding: EMPTY_AUTOPILOT_RATE, suggestion: EMPTY_AUTOPILOT_RATE },
  tallies: [],
};

export const AUTOPILOT_SCORED_KINDS = [
  'plan',
  'review',
  'merge',
] as const satisfies readonly AutopilotDecisionKind[];

export type AutopilotScoredKind = (typeof AUTOPILOT_SCORED_KINDS)[number];

export interface AutopilotTrackScore {
  scored: number;
  agreed: number;
  agreement: number | null;
  base: number | null;
  margin: number | null;
  loss: number | null;
}

export interface AutopilotScore {
  learned: number;
  scored: number;
  agreed: number;
  agreement: number | null;
  margin: number | null;
  value: number;
  progress: number;
  ready: boolean;
  suggested: AutopilotLevel;
  tracks: Record<AutopilotTrack, AutopilotTrackScore>;
}

export const AUTOPILOT_SCORE_LIMITS = {
  halfLife: 50,
  minScored: 50,
  agreement: 0.9,
  margin: 0.05,
  clamp: 0.01,
} as const;

export const AUTOPILOT_COMBINE_LIMITS = {
  veto: 0.5,
  confidence: 0.5,
} as const;
