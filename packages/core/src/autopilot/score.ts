import type { ShinsaState } from '../state/project.ts';
import type { AutopilotModelGuess } from './model/schema.ts';
import {
  AUTOPILOT_COMBINE_LIMITS,
  AUTOPILOT_READINESS_KINDS,
  AUTOPILOT_READINESS_LIMITS,
  AUTOPILOT_READINESS_TRACK,
  AUTOPILOT_SCORE_LIMITS,
  AUTOPILOT_TRACKS,
  type AutopilotAgreement,
  type AutopilotDecisionAnswer,
  type AutopilotFollowUpMatch,
  type AutopilotFollowUpScore,
  type AutopilotKindReadiness,
  type AutopilotProfile,
  type AutopilotReadiness,
  type AutopilotReadinessKind,
  type AutopilotRate,
  type AutopilotScore,
  type AutopilotTrack,
  type AutopilotTrackScore,
  type AutopilotVerdict,
  EMPTY_AUTOPILOT_KIND_PROFILE,
  EMPTY_AUTOPILOT_PROFILE,
} from './schema.ts';

const AGREEING_VERDICTS: Partial<Record<AutopilotDecisionAnswer, readonly AutopilotVerdict[]>> = {
  approved: ['act'],
  replied: ['act'],
  revised: ['revise', 'forward'],
  rejected: ['forward', 'cancel'],
};

export function isAutopilotAgreement(guess: AutopilotVerdict, answer: AutopilotDecisionAnswer) {
  return AGREEING_VERDICTS[answer]?.includes(guess) ?? false;
}

export function resolveAutopilotCombinedVerdict(
  call: AutopilotVerdict,
  guess: AutopilotModelGuess | null
): AutopilotVerdict {
  if (call === 'cancel') return isAutopilotCancelVeto(guess) ? 'forward' : 'cancel';
  if (call !== 'act') return call;
  return isAutopilotModelVeto(guess) ? 'forward' : 'act';
}

export function isAutopilotCancelVeto(guess: AutopilotModelGuess | null): guess is AutopilotModelGuess {
  if (!guess || guess.confidence < AUTOPILOT_COMBINE_LIMITS.confidence) return false;
  return guess.p >= AUTOPILOT_COMBINE_LIMITS.veto;
}

export function resolveAutopilotFollowUpScore(
  match: AutopilotFollowUpMatch | undefined
): AutopilotFollowUpScore {
  const { scored, matched } = match ?? EMPTY_AUTOPILOT_PROFILE.followUps;
  return { scored, matched, share: scored === 0 ? null : matched / scored };
}

export function isAutopilotModelVeto(guess: AutopilotModelGuess | null) {
  if (!guess || guess.confidence < AUTOPILOT_COMBINE_LIMITS.confidence) return false;
  return guess.p < AUTOPILOT_COMBINE_LIMITS.veto;
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
    followUps: resolveAutopilotFollowUpScore(profile.followUps),
  };
}

function resolveKindReadiness(
  profile: AutopilotProfile,
  kind: AutopilotReadinessKind
): AutopilotKindReadiness {
  const track = AUTOPILOT_READINESS_TRACK[kind];
  const score = resolveTrackScore((profile.kinds[kind] ?? EMPTY_AUTOPILOT_KIND_PROFILE).tracks[track]);
  const { minScored, agreement, margin } = AUTOPILOT_READINESS_LIMITS;
  const ready =
    score.scored >= minScored &&
    score.agreement !== null &&
    score.agreement >= agreement &&
    score.margin !== null &&
    score.margin >= margin;
  return { kind, track, score, ready };
}

export function resolveAutopilotReadiness(state: Pick<ShinsaState, 'autopilotProfile'>): AutopilotReadiness {
  const profile = state.autopilotProfile ?? EMPTY_AUTOPILOT_PROFILE;
  const kinds = AUTOPILOT_READINESS_KINDS.map((kind) => resolveKindReadiness(profile, kind));
  return { kinds, offered: kinds.some((kind) => kind.ready) };
}

export function isAutopilotKindReady(
  state: Pick<ShinsaState, 'autopilotProfile'>,
  kind: AutopilotReadinessKind
) {
  return resolveKindReadiness(state.autopilotProfile ?? EMPTY_AUTOPILOT_PROFILE, kind).ready;
}
