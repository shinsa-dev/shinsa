import type { AutopilotLevel } from '../domain/settings.ts';
import type { ReviewRating } from '../report/types.ts';

export type AutopilotGateKind = 'plan' | 'question' | 'review' | 'merge';

export interface AutopilotDone {
  gateId: string;
  taskId: string;
  gate: AutopilotGateKind;
  title: string;
  reason: string;
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

export const AUTOPILOT_VERDICTS = ['act', 'forward'] as const;

export type AutopilotVerdict = (typeof AUTOPILOT_VERDICTS)[number];

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

export const AUTOPILOT_LESSON_KINDS = ['acted', 'forwarded'] as const;

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

export interface AutopilotGateLessons {
  gate: AutopilotGateKind;
  acted: number;
  kept: number;
  corrected: number;
  forwarded: number;
  couldHaveActed: number;
  paused: boolean;
}

export interface AutopilotLessonSummary {
  gates: AutopilotGateLessons[];
  recent: AutopilotLesson[];
}

export const AUTOPILOT_LESSON_LIMITS = {
  kept: 50,
  prompt: 8,
  recent: 5,
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
] as const;

export type AutopilotDecisionAnswer = (typeof AUTOPILOT_DECISION_ANSWERS)[number];

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
  note: string | null;
}

export interface AutopilotTally {
  key: string;
  kind: AutopilotDecisionKind;
  projectId: string | null;
  risk: ReviewRating | null;
  total: number;
  answers: Partial<Record<AutopilotDecisionAnswer, number>>;
}

export interface AutopilotProfile {
  total: number;
  decisions: AutopilotDecision[];
  tallies: AutopilotTally[];
}

export const AUTOPILOT_PROFILE_LIMITS = {
  kept: 200,
  tallies: 300,
  note: 280,
  notes: 3,
  summary: 1200,
} as const;

export const EMPTY_AUTOPILOT_PROFILE: AutopilotProfile = { total: 0, decisions: [], tallies: [] };
