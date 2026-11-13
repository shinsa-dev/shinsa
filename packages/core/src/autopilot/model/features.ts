import { TASK_SHAPES, type TaskShape } from '../../domain/shapes.ts';
import type { ReviewRating } from '../../report/types.ts';
import type { AutopilotDecision } from '../schema.ts';
import { AUTOPILOT_HEAD_OF_KIND, AUTOPILOT_MODEL_LIMITS, type AutopilotFeature } from './schema.ts';

const HEAD_KINDS = Object.keys(AUTOPILOT_HEAD_OF_KIND);

const RATINGS: readonly (ReviewRating | null)[] = ['low', 'medium', 'high', null];

const SHAPES: readonly TaskShape[] = [...TASK_SHAPES, 'lead'];

const HOUR_BANDS = 4;

const FLAGS = ['urgent', 'watchdog', 'active', 'inHours', 'heldPlan', 'hasPlan'] as const;

const NUMBERS = ['phases', 'files', 'blocking', 'shouldFix', 'optional', 'revisions'] as const;

type Flag = (typeof FLAGS)[number];

type NumberFeature = (typeof NUMBERS)[number];

const BLOCK_SIZES = {
  bias: 1,
  kind: HEAD_KINDS.length,
  risk: RATINGS.length,
  confidence: RATINGS.length,
  shape: SHAPES.length,
  hour: HOUR_BANDS,
  flags: FLAGS.length,
  numbers: NUMBERS.length,
  project: AUTOPILOT_MODEL_LIMITS.hashBuckets,
  repo: AUTOPILOT_MODEL_LIMITS.hashBuckets,
  kindRisk: HEAD_KINDS.length * RATINGS.length,
  kindConfidence: HEAD_KINDS.length * RATINGS.length,
  riskFiles: RATINGS.length,
  watchdogAway: 1,
} as const;

type Block = keyof typeof BLOCK_SIZES;

function resolveOffsets() {
  const offsets = {} as Record<Block, number>;
  let size = 0;
  for (const [block, length] of Object.entries(BLOCK_SIZES) as [Block, number][]) {
    offsets[block] = size;
    size += length;
  }
  return { offsets, size };
}

const LAYOUT = resolveOffsets();

export const AUTOPILOT_FEATURE_COUNT = LAYOUT.size;

const SCALE: Record<NumberFeature, number> = {
  phases: Math.log1p(12),
  files: Math.log1p(40),
  blocking: Math.log1p(5),
  shouldFix: Math.log1p(5),
  optional: Math.log1p(5),
  revisions: Math.log1p(5),
};

export function resolveFeatureHash(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % AUTOPILOT_MODEL_LIMITS.hashBuckets;
}

function resolveScaled(feature: NumberFeature, count: number) {
  return Math.log1p(Math.max(0, count)) / SCALE[feature];
}

function resolveNumbers(decision: AutopilotDecision): Record<NumberFeature, number> {
  const facts = decision.facts;
  return {
    phases: resolveScaled('phases', decision.scope?.phases ?? 0),
    files: resolveScaled('files', decision.scope?.files ?? 0),
    blocking: resolveScaled('blocking', facts?.findings.blocking ?? 0),
    shouldFix: resolveScaled('shouldFix', facts?.findings.shouldFix ?? 0),
    optional: resolveScaled('optional', facts?.findings.optional ?? 0),
    revisions: resolveScaled('revisions', facts?.revisions ?? 0),
  };
}

function resolveFlags(decision: AutopilotDecision): Record<Flag, boolean> {
  const facts = decision.facts;
  return {
    urgent: decision.urgent,
    watchdog: decision.watchdog,
    active: facts?.active ?? false,
    inHours: facts?.inHours === true,
    heldPlan: facts?.heldPlan ?? false,
    hasPlan: decision.scope !== null,
  };
}

export function listAutopilotFeatures(decision: AutopilotDecision): AutopilotFeature[] {
  const { offsets } = LAYOUT;
  const features: AutopilotFeature[] = [{ index: offsets.bias, value: 1 }];
  const add = (block: Block, slot: number, value = 1) => {
    if (slot >= 0 && value !== 0) features.push({ index: offsets[block] + slot, value });
  };
  const kind = HEAD_KINDS.indexOf(decision.kind);
  const risk = RATINGS.indexOf(decision.risk);
  const confidence = RATINGS.indexOf(decision.facts?.confidence ?? null);
  const numbers = resolveNumbers(decision);
  add('kind', kind);
  add('risk', risk);
  add('confidence', confidence);
  if (decision.facts) {
    add('shape', SHAPES.indexOf(decision.facts.shape));
    add('hour', Math.floor(decision.facts.hour / (24 / HOUR_BANDS)));
  }
  const flags = resolveFlags(decision);
  FLAGS.forEach((flag, slot) => add('flags', slot, flags[flag] ? 1 : 0));
  NUMBERS.forEach((feature, slot) => add('numbers', slot, numbers[feature]));
  if (decision.projectId) add('project', resolveFeatureHash(decision.projectId));
  if (decision.facts?.repoId) add('repo', resolveFeatureHash(decision.facts.repoId));
  if (kind >= 0) {
    add('kindRisk', kind * RATINGS.length + risk);
    add('kindConfidence', kind * RATINGS.length + confidence);
  }
  add('riskFiles', risk, numbers.files);
  add('watchdogAway', 0, decision.watchdog && !flags.active ? 1 : 0);
  return features;
}
