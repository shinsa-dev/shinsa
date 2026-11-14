import type { AutopilotDecision, AutopilotDecisionAnswer, AutopilotDecisionKind } from '../schema.ts';

export const AUTOPILOT_MODEL_HEADS = ['gate', 'finding', 'suggestion'] as const;

export type AutopilotModelHead = (typeof AUTOPILOT_MODEL_HEADS)[number];

export const AUTOPILOT_HEAD_OF_KIND: Partial<Record<AutopilotDecisionKind, AutopilotModelHead>> = {
  plan: 'gate',
  review: 'gate',
  merge: 'gate',
  proposal: 'gate',
  failure: 'gate',
  finding: 'finding',
  suggestion: 'suggestion',
};

export const AUTOPILOT_POSITIVE_ANSWERS: Record<AutopilotModelHead, readonly AutopilotDecisionAnswer[]> = {
  gate: ['approved', 'replied'],
  finding: ['fixed'],
  suggestion: ['accepted', 'kept'],
};

export interface AutopilotFeature {
  index: number;
  value: number;
}

export interface AutopilotHeadWeights {
  seen: number;
  weights: number[];
}

export interface AutopilotSegment {
  positive: number;
  negative: number;
}

export interface AutopilotModel {
  heads: Record<AutopilotModelHead, AutopilotHeadWeights>;
  segments: Record<string, AutopilotSegment>;
}

export interface AutopilotModelGuess {
  head: AutopilotModelHead;
  p: number;
  confidence: number;
  similar: number;
}

export interface AutopilotLearnedDecision extends AutopilotDecision {
  modelGuess: AutopilotModelGuess | null;
}

export const AUTOPILOT_MODEL_LIMITS = {
  rate: 0.05,
  l2: 0.001,
  segmentHalfLife: 100,
  segmentMinimum: 5,
  confidencePrior: 10,
  minSeen: 20,
  hashBuckets: 16,
  precision: 10_000,
} as const;

export const AUTOPILOT_RETRIEVAL_LIMITS = {
  examples: 8,
  budget: 2_400,
  title: 80,
  halfLife: 50,
  shortestWord: 3,
  weights: { features: 0.5, words: 0.15, terms: 0.2, recency: 0.15 },
} as const;
