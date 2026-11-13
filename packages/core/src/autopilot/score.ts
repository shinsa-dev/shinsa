import type { ShinsaState } from '../state/project.ts';
import {
  AUTOPILOT_SCORE_LIMITS,
  type AutopilotDecision,
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

function isScored(decision: AutopilotDecision) {
  return decision.guess !== null;
}

export function resolveAutopilotScore(state: Pick<ShinsaState, 'autopilotProfile'>): AutopilotScore {
  const profile = state.autopilotProfile ?? EMPTY_AUTOPILOT_PROFILE;
  const scored = profile.decisions.filter(isScored).slice(-AUTOPILOT_SCORE_LIMITS.window);
  const agreed = scored.filter(
    (decision) => decision.guess !== null && isAutopilotAgreement(decision.guess, decision.answer)
  ).length;
  const agreement = scored.length === 0 ? null : agreed / scored.length;
  const ready =
    scored.length >= AUTOPILOT_SCORE_LIMITS.minScored &&
    agreement !== null &&
    agreement >= AUTOPILOT_SCORE_LIMITS.agreement;
  return {
    learned: profile.total,
    scored: scored.length,
    agreed,
    agreement,
    ready,
    suggested: ready ? 'most' : 'balanced',
  };
}
