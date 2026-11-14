import { describe, expect, test } from 'bun:test';
import {
  isAutopilotModelVeto,
  AUTOPILOT_SCORE_LIMITS,
  type AutopilotDecision,
  type AutopilotDecisionAnswer,
  type AutopilotModelGuess,
  type AutopilotScoredDecision,
  type AutopilotVerdict,
  AUTOPILOT_READINESS_LIMITS,
  type AutopilotDecisionKind,
  isAutopilotAgreement,
  isAutopilotKindReady,
  recordAutopilotDecisions,
  resolveAutopilotBaseRate,
  resolveAutopilotCombinedVerdict,
  resolveAutopilotLoss,
  resolveAutopilotFollowUpScore,
  resolveAutopilotReadiness,
  resolveAutopilotScore,
  EMPTY_AUTOPILOT_PROFILE,
  type AutopilotProfile,
} from '../../src/index.ts';

const SURE: AutopilotModelGuess = { head: 'gate', p: 0.95, confidence: 0.8, similar: 40 };
const DOUBTFUL: AutopilotModelGuess = { head: 'gate', p: 0.2, confidence: 0.8, similar: 40 };

function decision(
  guess: AutopilotVerdict | null,
  answer: AutopilotDecisionAnswer = 'approved'
): AutopilotDecision {
  return {
    at: 1,
    taskId: 't',
    gateId: 'g',
    kind: 'plan',
    answer,
    projectId: null,
    risk: null,
    scope: null,
    urgent: false,
    watchdog: false,
    touched: true,
    guess,
    followUp: null,
    note: null,
    facts: null,
    estimate: null,
  };
}

function guessed(
  guess: AutopilotVerdict | null,
  answer: AutopilotDecisionAnswer,
  modelGuess: AutopilotModelGuess | null
): AutopilotScoredDecision {
  return { ...decision(guess, answer), estimate: guess === null ? null : modelGuess, modelGuess };
}

function scoreOf(decisions: AutopilotScoredDecision[]) {
  return resolveAutopilotScore({ autopilotProfile: recordAutopilotDecisions(undefined, decisions) });
}

describe('agreeing with you', () => {
  test('a guess to act agrees with an approval, a guess to bring it to you with a revision or rejection', () => {
    expect(isAutopilotAgreement('act', 'approved')).toBe(true);
    expect(isAutopilotAgreement('forward', 'approved')).toBe(false);
    expect(isAutopilotAgreement('forward', 'revised')).toBe(true);
    expect(isAutopilotAgreement('forward', 'rejected')).toBe(true);
    expect(isAutopilotAgreement('act', 'revised')).toBe(false);
  });

  test('a retry with your guidance agrees with a retry, and only your cancel agrees with a cancel', () => {
    expect(isAutopilotAgreement('act', 'replied')).toBe(true);
    expect(isAutopilotAgreement('forward', 'replied')).toBe(false);
    expect(isAutopilotAgreement('cancel', 'replied')).toBe(false);
    expect(isAutopilotAgreement('cancel', 'approved')).toBe(false);
    expect(isAutopilotAgreement('cancel', 'rejected')).toBe(true);
  });

  test('a follow-up agrees when you ask for a change, never when you approve or reject', () => {
    expect(isAutopilotAgreement('revise', 'revised')).toBe(true);
    expect(isAutopilotAgreement('revise', 'approved')).toBe(false);
    expect(isAutopilotAgreement('revise', 'rejected')).toBe(false);
    expect(isAutopilotAgreement('revise', 'replied')).toBe(false);
  });
});

describe('how often its follow-ups raise your topic', () => {
  test('counts a follow-up guess only when you revised with a topic, and matches it on a shared topic', () => {
    const revised = { ...decision('revise', 'revised'), note: 'What about auth on the new endpoint?' };
    const profile = recordAutopilotDecisions(undefined, [
      { ...revised, followUp: 'How does this check the token?' },
      { ...revised, followUp: 'Are the tests updated?' },
      { ...revised, followUp: null },
      { ...revised, followUp: 'Does it check the token?', note: 'Smaller, please.' },
      { ...revised, followUp: 'Is auth handled?', answer: 'approved' },
      { ...revised, guess: 'forward', followUp: 'Is auth handled?' },
    ]);
    expect(profile.followUps).toEqual({ scored: 2, matched: 1 });
    expect(resolveAutopilotScore({ autopilotProfile: profile }).followUps).toEqual({
      scored: 2,
      matched: 1,
      share: 0.5,
    });
  });

  test('has no share before it is scored, and reads a profile from an older engine', () => {
    expect(resolveAutopilotScore({ autopilotProfile: EMPTY_AUTOPILOT_PROFILE }).followUps.share).toBeNull();
    const older = { ...EMPTY_AUTOPILOT_PROFILE, followUps: undefined } as unknown as AutopilotProfile;
    expect(resolveAutopilotFollowUpScore(older.followUps)).toEqual({ scored: 0, matched: 0, share: null });
  });
});

describe('combining the model with the model call', () => {
  test('acts when the call says act, unless a sure model says you would not approve', () => {
    expect(resolveAutopilotCombinedVerdict('act', SURE)).toBe('act');
    expect(resolveAutopilotCombinedVerdict('forward', SURE)).toBe('forward');
    expect(resolveAutopilotCombinedVerdict('act', DOUBTFUL)).toBe('forward');
    expect(resolveAutopilotCombinedVerdict('act', { ...DOUBTFUL, confidence: 0.3 })).toBe('act');
    expect(resolveAutopilotCombinedVerdict('act', null)).toBe('act');
  });

  test('keeps a cancel, unless a sure model says you would retry', () => {
    expect(resolveAutopilotCombinedVerdict('cancel', DOUBTFUL)).toBe('cancel');
    expect(resolveAutopilotCombinedVerdict('cancel', null)).toBe('cancel');
    expect(resolveAutopilotCombinedVerdict('cancel', SURE)).toBe('forward');
    expect(resolveAutopilotCombinedVerdict('cancel', { ...SURE, confidence: 0.3 })).toBe('cancel');
  });

  test('keeps a follow-up as it is, whatever the model says', () => {
    expect(resolveAutopilotCombinedVerdict('revise', SURE)).toBe('revise');
    expect(resolveAutopilotCombinedVerdict('revise', DOUBTFUL)).toBe('revise');
  });
});

describe('the base rate and log loss', () => {
  test('the base rate starts at even and leans to the more common answer', () => {
    expect(resolveAutopilotBaseRate({ positive: 0, negative: 0 })).toBe(0.5);
    expect(resolveAutopilotBaseRate({ positive: 8, negative: 0 })).toBe(0.9);
  });

  test('log loss is small for a sure right guess, large and bounded for a sure wrong one', () => {
    expect(resolveAutopilotLoss(0.5, true)).toBeCloseTo(Math.log(2));
    expect(resolveAutopilotLoss(1, true)).toBeCloseTo(-Math.log(0.99));
    expect(resolveAutopilotLoss(1, false)).toBeCloseTo(-Math.log(0.01));
  });
});

describe('the Autopilot score', () => {
  test('has no agreement and suggests Balanced before any guess is scored', () => {
    const empty = resolveAutopilotScore({ autopilotProfile: undefined as never });
    expect(empty).toMatchObject({
      learned: 0,
      scored: 0,
      agreed: 0,
      agreement: null,
      margin: null,
      value: 0,
      progress: 0,
      ready: false,
      suggested: 'balanced',
    });
    expect(empty.tracks.base).toEqual({
      scored: 0,
      agreed: 0,
      agreement: null,
      base: null,
      margin: null,
      loss: null,
    });
    expect(scoreOf([decision(null), decision(null)])).toMatchObject({
      learned: 2,
      scored: 0,
      agreement: null,
      progress: 0,
    });
  });

  test('scores each track only where it guessed, and the base rate on every decision with a choice', () => {
    const score = scoreOf([
      guessed('act', 'approved', SURE),
      guessed('act', 'revised', SURE),
      guessed(null, 'approved', SURE),
      guessed('forward', 'rejected', DOUBTFUL),
      { ...decision(null, 'sent'), kind: 'message' },
    ]);
    expect(score.learned).toBe(5);
    expect(score.tracks.call).toMatchObject({ scored: 3, agreed: 2 });
    expect(score.tracks.combined).toMatchObject({ scored: 3, agreed: 2 });
    expect(score.tracks.model).toMatchObject({ scored: 4, agreed: 3 });
    expect(score.tracks.base).toMatchObject({ scored: 4 });
    expect(score).toMatchObject({ scored: 3, agreed: 2, ready: false, suggested: 'balanced' });
    expect(score.agreement).toBeCloseTo(2 / 3);
  });

  test('the combined verdict brings a gate to you when the model doubts what the call would do', () => {
    const score = scoreOf([guessed('act', 'revised', DOUBTFUL), guessed('act', 'approved', DOUBTFUL)]);
    expect(score.tracks.call.agreed).toBe(1);
    expect(score.tracks.combined.agreed).toBe(1);
    expect(scoreOf([guessed('act', 'revised', DOUBTFUL)]).tracks).toMatchObject({
      call: { agreed: 0 },
      combined: { agreed: 1 },
    });
  });

  test('the combined verdict reads the estimate Autopilot had when it judged, not the one learned at your answer', () => {
    const judged = { ...guessed('act', 'revised', SURE), estimate: DOUBTFUL };
    expect(scoreOf([judged]).tracks).toMatchObject({ model: { agreed: 0 }, combined: { agreed: 1 } });
    const later = { ...guessed('act', 'revised', DOUBTFUL), estimate: SURE };
    expect(scoreOf([later]).tracks).toMatchObject({ model: { agreed: 1 }, combined: { agreed: 0 } });
  });

  test('a sure model vetoes only when it thinks you would more likely not approve', () => {
    expect(isAutopilotModelVeto({ ...DOUBTFUL, p: 0.8 })).toBe(false);
    expect(isAutopilotModelVeto({ ...DOUBTFUL, p: 0.49 })).toBe(true);
    expect(isAutopilotModelVeto({ ...DOUBTFUL, confidence: 0.1 })).toBe(false);
    expect(isAutopilotModelVeto(null)).toBe(false);
  });

  test('compares each track with the base rate on the same decisions', () => {
    const score = scoreOf([
      guessed('act', 'approved', SURE),
      guessed('act', 'approved', SURE),
      guessed('act', 'approved', SURE),
    ]);
    expect(score.tracks.combined.agreement).toBe(1);
    expect(score.tracks.combined.base).toBeCloseTo(1);
    expect(score.margin).toBeCloseTo(0);
    expect(score.tracks.model.loss).toBeLessThan(score.tracks.base.loss ?? 0);
  });

  test('never suggests Most things while always approving would score as well', () => {
    const agreeing = Array.from({ length: AUTOPILOT_SCORE_LIMITS.minScored }, () =>
      guessed('act', 'approved', SURE)
    );
    expect(scoreOf(agreeing)).toMatchObject({
      scored: 50,
      agreement: 1,
      value: 100,
      progress: 1,
      ready: false,
    });
    expect(scoreOf(agreeing).suggested).toBe('balanced');
  });

  test('suggests Most things at 90% agreement and a clear lead over the base rate', () => {
    const mixed = Array.from({ length: 60 }, (_, index) =>
      index % 3 === 0 ? guessed('forward', 'revised', DOUBTFUL) : guessed('act', 'approved', SURE)
    );
    const score = scoreOf(mixed);
    expect(score).toMatchObject({ scored: 60, agreed: 60, agreement: 1, ready: true, suggested: 'most' });
    expect(score.margin).toBeGreaterThanOrEqual(AUTOPILOT_SCORE_LIMITS.margin);
    expect(scoreOf(mixed.slice(11))).toMatchObject({ scored: 49, progress: 0.98, ready: false });
  });

  test('counts every guess it ever made, the recent ones the most', () => {
    const wrong = () => guessed('act', 'revised', SURE);
    const right = (index: number) =>
      index % 3 === 0 ? guessed('forward', 'revised', DOUBTFUL) : guessed('act', 'approved', SURE);
    const old = Array.from({ length: 200 }, wrong);
    const recent = Array.from({ length: 300 }, (_, index) => right(index));
    const score = scoreOf([...old, ...recent]);
    expect(score).toMatchObject({ learned: 500, scored: 500, ready: true });
    expect(score.agreement).toBeGreaterThan(0.9);
    expect(scoreOf([...recent, ...old])).toMatchObject({ scored: 500, ready: false });
  });

  test('keeps scoring apart from the words it keeps, so findings and questions never push guesses out', () => {
    const unscored = (kind: AutopilotDecision['kind']) => ({ ...decision(null, 'fixed'), kind });
    let profile = recordAutopilotDecisions(undefined, []);
    for (let review = 0; review < 100; review += 1) {
      profile = recordAutopilotDecisions(profile, [
        { ...guessed('act', 'approved', SURE), kind: 'review' },
        ...Array.from({ length: 4 }, () => unscored('finding')),
        unscored('question'),
      ]);
    }
    expect(resolveAutopilotScore({ autopilotProfile: profile })).toMatchObject({
      learned: 600,
      scored: 100,
      agreed: 100,
    });
    expect(profile.decisions.every((kept) => !('modelGuess' in kept))).toBe(true);
    expect(profile.rates.finding.positive).toBeGreaterThan(0);
  });
});

describe('readiness for Everything, per kind of gate', () => {
  const FIXING: AutopilotModelGuess = { head: 'finding', p: 0.9, confidence: 0.8, similar: 40 };
  const DISMISSING: AutopilotModelGuess = { head: 'finding', p: 0.1, confidence: 0.8, similar: 40 };

  function ofKind(kind: AutopilotDecisionKind, decisions: AutopilotScoredDecision[]) {
    return decisions.map((entry) => ({ ...entry, kind }));
  }

  function mixed(length: number) {
    return Array.from({ length }, (_, index) =>
      index % 3 === 0 ? guessed('forward', 'revised', DOUBTFUL) : guessed('act', 'approved', SURE)
    );
  }

  function readinessOf(decisions: AutopilotScoredDecision[]) {
    const state = { autopilotProfile: recordAutopilotDecisions(undefined, decisions) };
    return { state, readiness: resolveAutopilotReadiness(state) };
  }

  test('lists every kind it can earn, none ready and Everything not offered before any decision', () => {
    const { readiness } = readinessOf([]);
    expect(readiness.offered).toBe(false);
    expect(readiness.kinds.map(({ kind, track, ready }) => [kind, track, ready])).toEqual([
      ['plan', 'combined', false],
      ['review', 'combined', false],
      ['merge', 'combined', false],
      ['proposal', 'combined', false],
      ['failure', 'combined', false],
      ['finding', 'model', false],
    ]);
    expect(readiness.kinds[0]?.score).toMatchObject({ scored: 0, agreement: null, margin: null });
  });

  test('a kind is ready at 100 of its own decisions, 90% agreement and 5 points over your usual answer', () => {
    const { state, readiness } = readinessOf(mixed(AUTOPILOT_READINESS_LIMITS.minScored));
    const plan = readiness.kinds.find((kind) => kind.kind === 'plan');
    expect(plan).toMatchObject({ ready: true, score: { scored: 100, agreed: 100, agreement: 1 } });
    expect(plan?.score.margin).toBeGreaterThanOrEqual(AUTOPILOT_READINESS_LIMITS.margin);
    expect(readiness.offered).toBe(true);
    expect(isAutopilotKindReady(state, 'plan')).toBe(true);
    expect(isAutopilotKindReady(state, 'review')).toBe(false);
  });

  test('99 decisions are not enough, however well it guessed', () => {
    const { state, readiness } = readinessOf(mixed(AUTOPILOT_READINESS_LIMITS.minScored - 1));
    expect(readiness.offered).toBe(false);
    expect(isAutopilotKindReady(state, 'plan')).toBe(false);
  });

  test('a kind you always approve is not ready, since your usual answer does as well', () => {
    const always = Array.from({ length: 120 }, () => guessed('act', 'approved', SURE));
    const { state } = readinessOf(always);
    expect(isAutopilotKindReady(state, 'plan')).toBe(false);
  });

  test('a kind that agrees too rarely is not ready', () => {
    const wrong = Array.from({ length: 120 }, (_, index) =>
      index % 5 === 0 ? guessed('act', 'revised', SURE) : (mixed(1)[0] ?? guessed(null, 'approved', null))
    );
    expect(isAutopilotKindReady(readinessOf(wrong).state, 'plan')).toBe(false);
  });

  test('each kind is scored against its own usual answer, not the other kinds of its head', () => {
    const merges = ofKind(
      'merge',
      Array.from({ length: 200 }, () => guessed('act', 'approved', SURE))
    );
    const { state } = readinessOf([...merges, ...ofKind('review', mixed(120))]);
    const profile = state.autopilotProfile;
    expect(profile.kinds.review?.tracks.combined.scored).toBe(120);
    expect(profile.kinds.merge?.tracks.combined.scored).toBe(200);
    expect(profile.kinds.plan).toBeUndefined();
    expect(profile.kinds.review?.rate.negative).toBeGreaterThan(0);
    expect(profile.kinds.merge?.rate.negative).toBe(0);
    expect(isAutopilotKindReady(state, 'review')).toBe(true);
    expect(isAutopilotKindReady(state, 'merge')).toBe(false);
  });

  test('findings are scored on the local model, which decides them', () => {
    const findings = Array.from({ length: 120 }, (_, index) => ({
      ...decision(null, index % 3 === 0 ? 'dismissed' : 'fixed'),
      kind: 'finding' as const,
      modelGuess: index % 3 === 0 ? DISMISSING : FIXING,
    }));
    const { state, readiness } = readinessOf(findings);
    expect(readiness.kinds.find((kind) => kind.kind === 'finding')?.score).toMatchObject({
      scored: 120,
      agreement: 1,
    });
    expect(isAutopilotKindReady(state, 'finding')).toBe(true);
    expect(state.autopilotProfile.kinds.finding?.tracks.combined.scored).toBe(0);
  });
});
