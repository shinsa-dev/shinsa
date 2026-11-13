import type { ShinsaState } from '../state/project.ts';
import {
  AUTOPILOT_SCORE_LIMITS,
  type AutopilotDecisionAnswer,
  type AutopilotScore,
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

function resolveScoreValue(agreement: number | null, confidence: number) {
  if (agreement === null) return 0;
  const reach =
    confidence < 1 ? Math.min(agreement, confidence * AUTOPILOT_SCORE_LIMITS.agreement) : agreement;
  return Math.floor(reach * 100);
}

export function resolveAutopilotScore(state: Pick<ShinsaState, 'autopilotProfile'>): AutopilotScore {
  const profile = state.autopilotProfile ?? EMPTY_AUTOPILOT_PROFILE;
  const { scored, agreed, weight, agreedWeight } = profile.agreement;
  const agreement = weight === 0 ? null : agreedWeight / weight;
  const { minScored, agreement: bar } = AUTOPILOT_SCORE_LIMITS;
  const confidence = Math.min(1, scored / minScored);
  const progress = agreement === null ? 0 : Math.min(1, confidence, agreement / bar);
  const ready = progress >= 1;
  return {
    learned: profile.total,
    scored,
    agreed,
    agreement,
    value: resolveScoreValue(agreement, confidence),
    progress,
    ready,
    suggested: ready ? 'most' : 'balanced',
  };
}
