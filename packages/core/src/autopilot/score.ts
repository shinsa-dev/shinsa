import type { ShinsaState } from '../state/project.ts';
import type { AutopilotModelGuess } from './model/schema.ts';
import {
  AUTOPILOT_COMBINE_LIMITS,
  AUTOPILOT_SCORE_LIMITS,
  AUTOPILOT_TRACKS,
  type AutopilotAgreement,
  type AutopilotDecisionAnswer,
  type AutopilotRate,
  type AutopilotScore,
  type AutopilotTrack,
  type AutopilotTrackScore,
  type AutopilotVerdict,
  EMPTY_AUTOPILOT_PROFILE,
} from './schema.ts';

const AGREEING_VERDICT: Partial<Record<AutopilotDecisionAnswer, AutopilotVerdict>> = {
  approved: 'act',
  revised: 'forward',
  rejected: 'forward',
};

export function isAutopilotAgreement(guess: AutopilotVerdict, answer: AutopilotDecisionAnswer) {
  return AGREEING_VERDICT[answer] === guess;
}

export function resolveAutopilotCombinedVerdict(
  call: AutopilotVerdict,
  guess: AutopilotModelGuess | null
): AutopilotVerdict {
  if (call !== 'act') return 'forward';
  return isAutopilotModelVeto(guess) ? 'forward' : 'act';
}

export function isAutopilotModelVeto(guess: AutopilotModelGuess | null) {
  if (!guess || guess.confidence < AUTOPILOT_COMBINE_LIMITS.confidence) return false;
  return guess.p < AUTOPILOT_COMBINE_LIMITS.act;
}

export function resolveAutopilotBaseRate(rate: AutopilotRate) {
  return (rate.positive + 1) / (rate.positive + rate.negative + 2);
}

export function resolveAutopilotLoss(p: number, positive: boolean) {
  const { clamp } = AUTOPILOT_SCORE_LIMITS;
  const bounded = Math.min(1 - clamp, Math.max(clamp, positive ? p : 1 - p));
  return -Math.log(bounded);
}

function resolveTrackScore(agreement: AutopilotAgreement): AutopilotTrackScore {
  const { scored, agreed, weight, agreedWeight, baseWeight, loss } = agreement;
  if (weight === 0) return { scored, agreed, agreement: null, base: null, margin: null, loss: null };
  const share = agreedWeight / weight;
  const base = baseWeight / weight;
  return { scored, agreed, agreement: share, base, margin: share - base, loss: loss / weight };
}

function resolveScoreValue(agreement: number | null, confidence: number) {
  if (agreement === null) return 0;
  const reach =
    confidence < 1 ? Math.min(agreement, confidence * AUTOPILOT_SCORE_LIMITS.agreement) : agreement;
  return Math.floor(reach * 100);
}

export function resolveAutopilotScore(state: Pick<ShinsaState, 'autopilotProfile'>): AutopilotScore {
  const profile = state.autopilotProfile ?? EMPTY_AUTOPILOT_PROFILE;
  const tracks = Object.fromEntries(
    AUTOPILOT_TRACKS.map((track) => [track, resolveTrackScore(profile.tracks[track])])
  ) as Record<AutopilotTrack, AutopilotTrackScore>;
  const { scored, agreed, agreement, margin } = tracks.combined;
  const { minScored, agreement: bar, margin: lead } = AUTOPILOT_SCORE_LIMITS;
  const confidence = Math.min(1, scored / minScored);
  const progress = agreement === null ? 0 : Math.min(1, confidence, agreement / bar);
  const ready = progress >= 1 && margin !== null && margin >= lead;
  return {
    learned: profile.total,
    scored,
    agreed,
    agreement,
    margin,
    value: resolveScoreValue(agreement, confidence),
    progress,
    ready,
    suggested: ready ? 'most' : 'balanced',
    tracks,
  };
}
