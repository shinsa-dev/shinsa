import { describe, expect, it } from 'bun:test';
import type { ReviewFinding } from '@shinsa/core';
import {
  createVerdictDraft,
  describeApproveHint,
  describeEscalationBody,
  describeReviewTitle,
  listVerdicts,
  resolveVerdict,
  resolveVerdictAction,
  VERDICT_ITEMS,
} from '@/lib/overview/verdicts.ts';
import { createGate } from '../../support/state.ts';

const FINDINGS: ReviewFinding[] = [
  { severity: 'blocking', file: 'a.ts', line: 1, message: 'Off by one.' },
  { severity: 'suggestion', file: null, line: null, message: 'Rename it.' },
];

describe('finding verdicts', () => {
  it('starts with blocking findings to fix and suggestions dismissed', () => {
    const draft = createVerdictDraft(FINDINGS);
    expect(draft).toEqual({ 0: 'fix', 1: 'dismiss' });
    expect(listVerdicts(FINDINGS, draft)).toEqual([
      { index: 0, verdict: 'fix', note: null },
      { index: 1, verdict: 'dismiss', note: null },
    ]);
    expect(listVerdicts(FINDINGS, {})).toEqual([
      { index: 0, verdict: 'dismiss', note: null },
      { index: 1, verdict: 'dismiss', note: null },
    ]);
  });

  it('kept findings send the work back; dismissing every one approves it', () => {
    expect(resolveVerdictAction(FINDINGS, { 0: 'fix', 1: 'fix' })).toEqual({
      reply: 'fixFindings',
      label: 'Fix 2 findings',
    });
    expect(resolveVerdictAction(FINDINGS, { 0: 'fix', 1: 'dismiss' }).label).toBe('Fix 1 finding');
    expect(resolveVerdictAction(FINDINGS, { 0: 'dismiss', 1: 'dismiss' })).toEqual({
      reply: 'approveChanges',
      label: 'Approve changes',
    });
    expect(resolveVerdictAction([], {}).reply).toBe('approveChanges');
  });

  it('offers fix or dismiss per finding and says what the primary action will do', () => {
    expect(VERDICT_ITEMS.map((item) => item.label)).toEqual(['Fix', 'Dismiss']);
    expect(resolveVerdict({ 0: 'fix' }, 0)).toBe('fix');
    expect(resolveVerdict({}, 3)).toBe('dismiss');
    const approve = resolveVerdictAction(FINDINGS, {});
    const fix = resolveVerdictAction(FINDINGS, { 0: 'fix' });
    expect(describeApproveHint(true, approve)).toBe(
      'Send your line comments to the agent or remove them first'
    );
    expect(describeApproveHint(false, approve)).toBe('Opens the pull request');
    expect(describeApproveHint(false, fix)).toBe('Sends the findings you kept to the fixer');
  });

  it('says why the review came to you', () => {
    const stalled = { reason: 'stalled' as const, rounds: 1, at: 1 };
    const rounds = { reason: 'rounds' as const, rounds: 2, at: 1 };
    const review = (escalation?: typeof stalled | typeof rounds) =>
      createGate({ id: 'g', taskId: 't', kind: 'review', ...(escalation ? { escalation } : {}) });
    expect(describeReviewTitle(review(stalled))).toBe(
      'The fix changed nothing and the same findings came back'
    );
    expect(describeReviewTitle(review(rounds))).toBe('The agents could not settle the review');
    expect(describeReviewTitle(review())).toBe('Built and checked. Your turn to review the changes.');
    expect(describeReviewTitle(createGate({ id: 'g', taskId: 't', kind: 'merge' }))).toBe(
      'The pull request is clean and ready to merge'
    );
    expect(describeEscalationBody(stalled)).toContain('Shinsa stopped instead of trying again.');
    expect(describeEscalationBody(rounds)).toBe(
      'The reviewer still had findings after 2 fix rounds. Decide on each one: keep the ones to fix, dismiss the rest.'
    );
  });
});
