import { Option } from 'effect';
import type { AutopilotDecision } from '../schema.ts';
import { AUTOPILOT_FEATURE_COUNT, listAutopilotFeatures } from './features.ts';
import {
  AUTOPILOT_HEAD_OF_KIND,
  AUTOPILOT_MODEL_HEADS,
  AUTOPILOT_MODEL_LIMITS,
  AUTOPILOT_POSITIVE_ANSWERS,
  type AutopilotFeature,
  type AutopilotHeadWeights,
  type AutopilotLearnedDecision,
  type AutopilotModel,
  type AutopilotModelGuess,
  type AutopilotModelHead,
  type AutopilotSegment,
} from './schema.ts';

function createHead(): AutopilotHeadWeights {
  return { seen: 0, weights: Array.from({ length: AUTOPILOT_FEATURE_COUNT }, () => 0) };
}

export function createAutopilotModel(): AutopilotModel {
  const heads = Object.fromEntries(AUTOPILOT_MODEL_HEADS.map((head) => [head, createHead()]));
  return { heads: heads as AutopilotModel['heads'], segments: {} };
}

function resolveScore(weights: readonly number[], features: readonly AutopilotFeature[]) {
  let sum = 0;
  for (const feature of features) sum += (weights[feature.index] ?? 0) * feature.value;
  return sum;
}

function resolveSigmoid(score: number) {
  return 1 / (1 + Math.exp(-score));
}

function round(value: number) {
  return Math.round(value * AUTOPILOT_MODEL_LIMITS.precision) / AUTOPILOT_MODEL_LIMITS.precision;
}

export function listAutopilotSegmentKeys(head: AutopilotModelHead, decision: AutopilotDecision) {
  const project = decision.projectId ?? '';
  const risk = decision.risk ?? '';
  const keys = [
    [head, decision.kind, project, risk].join('|'),
    [head, decision.kind, project, ''].join('|'),
    [head, decision.kind, '', risk].join('|'),
    [head, decision.kind, '', ''].join('|'),
  ];
  return [...new Set(keys)];
}

function resolveSegmentWeight(segment: AutopilotSegment | undefined) {
  return segment ? segment.positive + segment.negative : 0;
}

function resolveSimilar(model: AutopilotModel, head: AutopilotModelHead, decision: AutopilotDecision) {
  const weights = listAutopilotSegmentKeys(head, decision).map((key) =>
    resolveSegmentWeight(model.segments[key])
  );
  return weights.find((weight) => weight >= AUTOPILOT_MODEL_LIMITS.segmentMinimum) ?? weights.at(-1) ?? 0;
}

export function selectAutopilotModelGuess(
  model: AutopilotModel | undefined,
  decision: AutopilotDecision
): Option.Option<AutopilotModelGuess> {
  const head = AUTOPILOT_HEAD_OF_KIND[decision.kind];
  if (!head) return Option.none();
  const current = model ?? createAutopilotModel();
  const weights = current.heads[head];
  const p = resolveSigmoid(resolveScore(weights.weights, listAutopilotFeatures(decision)));
  const similar = resolveSimilar(current, head, decision);
  const warmed = Math.min(1, weights.seen / AUTOPILOT_MODEL_LIMITS.minSeen);
  const confidence = (similar / (similar + AUTOPILOT_MODEL_LIMITS.confidencePrior)) * warmed;
  return Option.some({ head, p: round(p), confidence: round(confidence), similar: round(similar) });
}

export function isAutopilotPositive(head: AutopilotModelHead, decision: AutopilotDecision) {
  return AUTOPILOT_POSITIVE_ANSWERS[head].includes(decision.answer);
}

function stepHead(weights: AutopilotHeadWeights, features: readonly AutopilotFeature[], label: number) {
  const { rate, l2 } = AUTOPILOT_MODEL_LIMITS;
  const error = label - resolveSigmoid(resolveScore(weights.weights, features));
  const next = weights.weights.map((weight) => weight * (1 - rate * l2));
  for (const feature of features)
    next[feature.index] = (next[feature.index] ?? 0) + rate * error * feature.value;
  return { seen: weights.seen + 1, weights: next };
}

function stepSegments(
  segments: AutopilotModel['segments'],
  keys: readonly string[],
  positive: boolean
): AutopilotModel['segments'] {
  const factor = 0.5 ** (1 / AUTOPILOT_MODEL_LIMITS.segmentHalfLife);
  const next = { ...segments };
  for (const key of keys) {
    const segment = next[key] ?? { positive: 0, negative: 0 };
    next[key] = {
      positive: segment.positive * factor + (positive ? 1 : 0),
      negative: segment.negative * factor + (positive ? 0 : 1),
    };
  }
  return next;
}

function learnOne(model: AutopilotModel, decision: AutopilotDecision): AutopilotModel {
  const head = AUTOPILOT_HEAD_OF_KIND[decision.kind];
  if (!head) return model;
  const positive = isAutopilotPositive(head, decision);
  return {
    heads: {
      ...model.heads,
      [head]: stepHead(model.heads[head], listAutopilotFeatures(decision), positive ? 1 : 0),
    },
    segments: stepSegments(model.segments, listAutopilotSegmentKeys(head, decision), positive),
  };
}

export function learnAutopilotDecisions(
  model: AutopilotModel | undefined,
  decisions: readonly AutopilotDecision[]
): { model: AutopilotModel; learned: AutopilotLearnedDecision[] } {
  let current = model ?? createAutopilotModel();
  const learned: AutopilotLearnedDecision[] = [];
  for (const decision of decisions) {
    const guess = selectAutopilotModelGuess(current, decision);
    learned.push({ ...decision, modelGuess: Option.getOrNull(guess) });
    current = learnOne(current, decision);
  }
  return { model: current, learned };
}
