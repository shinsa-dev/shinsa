import type { AutopilotLevel } from '../domain/settings.ts';
import type { ReviewRating } from '../report/types.ts';

export type AutopilotGateKind = 'plan' | 'question' | 'review' | 'merge';

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

export type AutopilotLimit = { allowed: true } | { allowed: false; reason: string };

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
