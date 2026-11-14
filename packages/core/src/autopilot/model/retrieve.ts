import type { AutopilotDecision } from '../schema.ts';
import { listAutopilotFeatures } from './features.ts';
import {
  AUTOPILOT_RETRIEVAL_LIMITS,
  type AutopilotFeature,
  type AutopilotLearnedDecision,
} from './schema.ts';

export interface AutopilotNeighbour {
  decision: AutopilotLearnedDecision;
  similarity: number;
}

const WORD = /[\p{L}\p{N}]+/gu;

export function listAutopilotWords(text: string): Set<string> {
  const words = text.toLowerCase().match(WORD) ?? [];
  return new Set(words.filter((word) => word.length >= AUTOPILOT_RETRIEVAL_LIMITS.shortestWord));
}

function resolveNorm(features: readonly AutopilotFeature[]) {
  return Math.sqrt(features.reduce((sum, feature) => sum + feature.value * feature.value, 0));
}

function resolveCosine(a: readonly AutopilotFeature[], b: readonly AutopilotFeature[]) {
  const values = new Map(a.map((feature) => [feature.index, feature.value]));
  let dot = 0;
  for (const feature of b) dot += (values.get(feature.index) ?? 0) * feature.value;
  const norm = resolveNorm(a) * resolveNorm(b);
  return norm === 0 ? 0 : dot / norm;
}

function resolveOverlap<T>(a: ReadonlySet<T>, b: ReadonlySet<T>) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function listDecisionTerms(decision: AutopilotDecision): Set<number> {
  return new Set(decision.facts?.work?.terms ?? []);
}

export function listAutopilotNeighbours(
  history: readonly AutopilotLearnedDecision[],
  probe: AutopilotDecision,
  probeText: string,
  resolveText: (decision: AutopilotDecision) => string
): AutopilotNeighbour[] {
  const { weights, halfLife, examples } = AUTOPILOT_RETRIEVAL_LIMITS;
  const features = listAutopilotFeatures(probe);
  const words = listAutopilotWords(probeText);
  const terms = listDecisionTerms(probe);
  const candidates = history.filter(
    (decision) => decision.kind === probe.kind && decision.gateId !== probe.gateId
  );
  return candidates
    .map((decision, index) => {
      const age = candidates.length - 1 - index;
      const similarity =
        weights.features * resolveCosine(features, listAutopilotFeatures(decision)) +
        weights.words * resolveOverlap(words, listAutopilotWords(resolveText(decision))) +
        weights.terms * resolveOverlap(terms, listDecisionTerms(decision)) +
        weights.recency * 0.5 ** (age / halfLife);
      return { decision, similarity, age };
    })
    .sort((a, b) => b.similarity - a.similarity || a.age - b.age)
    .slice(0, examples)
    .map(({ decision, similarity }) => ({ decision, similarity }));
}
