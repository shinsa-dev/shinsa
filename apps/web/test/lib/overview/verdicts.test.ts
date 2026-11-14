import { describe, expect, it } from 'bun:test';
import type { ReviewFinding } from '@shinsa/core';
import {
  canMergeAhead,
  createVerdictDraft,
  describeApproveHint,
  describeEscalationBody,
  describeReviewTitle,
  isFixingAction,
  isVerdictActionBlocked,
  listFollowUpChoices,
  listVerdicts,
  resolveChosenFollowUp,
  resolveFollowUp,
  resolveFollowUpFlags,
  resolveVerdict,
  resolveVerdictAction,
  resolveVerdictAnswer,
  resolveVerdictDraft,
  VERDICT_ITEMS,
} from '@/lib/overview/verdicts.ts';
import { createGate, createShinsaState, createTask } from '../../support/state.ts';

const FINDINGS: ReviewFinding[] = [
  { severity: 'blocking', file: 'a.ts', line: 1, message: 'Off by one.' },
  { severity: 'optional', file: null, line: null, message: 'Rename it.' },
];

const RANKED: ReviewFinding[] = [
  { severity: 'optional', file: null, line: null, message: 'Rename it.' },
  { severity: 'should_fix', file: 'b.ts', line: 4, message: 'The empty list is never handled.' },
  { severity: 'blocking', file: 'a.ts', line: 1, message: 'Off by one.' },
];

describe('finding verdicts', () => {
  it('lays the verdicts you chose over the defaults', () => {
    expect(resolveVerdictDraft(FINDINGS, { 1: 'fix' })).toEqual({ 0: 'fix', 1: 'fix' });
    expect(resolveVerdictDraft(FINDINGS, {})).toEqual({ 0: 'fix', 1: 'dismiss' });
  });

  it('starts blocking and should fix findings on Fix, and only optional ones on Dismiss', () => {
    expect(createVerdictDraft(RANKED)).toEqual({ 0: 'dismiss', 1: 'fix', 2: 'fix' });
    expect(resolveVerdictAction(RANKED, createVerdictDraft(RANKED))).toEqual({
      reply: 'fixFindings',
      label: 'Fix 2 findings',
    });
  });

  it('starts with blocking findings to fix and optional ones dismissed', () => {
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

  it('fixes then approves when you chose it, and only while there is something to fix', () => {
    const then = resolveVerdictAction(FINDINGS, { 0: 'fix' }, true);
    expect(then).toEqual({ reply: 'fixFindingsAndApprove', label: 'Fix 1 finding and approve' });
    expect(resolveVerdictAction(FINDINGS, {}, true).reply).toBe('approveChanges');
    expect([isFixingAction(then), isFixingAction(resolveVerdictAction(FINDINGS, {}))]).toEqual([true, false]);
    expect(isVerdictActionBlocked(true, then)).toBe(false);
    expect(describeApproveHint(false, then)).toBe(
      'Sends the findings you kept, then approves once checks and the agent review pass'
    );
    expect(describeApproveHint(true, then)).toBe(
      'Sends the findings you kept and your line comments, then approves once checks and the agent review pass'
    );
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
    expect(describeApproveHint(false, fix)).toBe('Sends the findings you kept to the agent');
    expect(describeApproveHint(true, fix)).toBe(
      'Sends the findings you kept and your line comments to the agent'
    );
  });

  it('blocks approving while comments are drafted, and sends them with the findings you kept', () => {
    const approve = resolveVerdictAction(FINDINGS, {});
    const fix = resolveVerdictAction(FINDINGS, { 0: 'fix' });
    expect(isVerdictActionBlocked(true, approve)).toBe(true);
    expect(isVerdictActionBlocked(false, approve)).toBe(false);
    expect(isVerdictActionBlocked(true, fix)).toBe(false);
    const comment = {
      id: 'c-1',
      ref: null,
      path: 'a.ts',
      side: 'new' as const,
      line: 2,
      endLine: null,
      text: 'Here.',
    };
    expect(resolveVerdictAnswer(FINDINGS, { 0: 'fix' }, [comment])).toEqual({
      verdicts: [
        { index: 0, verdict: 'fix', note: null },
        { index: 1, verdict: 'dismiss', note: null },
      ],
      comments: [{ path: 'a.ts', side: 'new', line: 2, endLine: null, text: 'Here.' }],
    });
    expect(resolveVerdictAnswer(FINDINGS, {}, [comment])).toEqual({
      verdicts: [
        { index: 0, verdict: 'dismiss', note: null },
        { index: 1, verdict: 'dismiss', note: null },
      ],
    });
    expect(resolveVerdictAnswer([], {}, [])).toEqual({});
  });

  it('says why the review came to you', () => {
    const stalled = { reason: 'stalled' as const, rounds: 1, at: 1 };
    const rounds = { reason: 'rounds' as const, rounds: 2, at: 1 };
    const review = (escalation?: typeof stalled | typeof rounds) =>
      createGate({ id: 'g', taskId: 't', type: 'review', ...(escalation ? { escalation } : {}) });
    expect(describeReviewTitle(review(stalled))).toBe(
      'The fix changed nothing and the same findings came back'
    );
    expect(describeReviewTitle(review(rounds))).toBe('The agents could not settle the review');
    expect(describeReviewTitle(review())).toBe('Built and checked. Your turn to review the changes.');
    expect(describeReviewTitle(createGate({ id: 'g', taskId: 't', type: 'merge' }))).toBe(
      'The pull request is clean and ready to merge'
    );
    expect(describeEscalationBody(stalled)).toContain('Shinsa stopped instead of trying again.');
    expect(describeEscalationBody(rounds)).toBe(
      'The reviewer still had findings after 2 fix rounds. Decide on each one: keep the ones to fix, dismiss the rest.'
    );
  });
});

describe('approving and merging once ready', () => {
  const BOTH = { approveAfterFix: true, approveAndMerge: true };

  it('names the merge once ready choices, after a fix or at once', () => {
    const merge = resolveVerdictAction(FINDINGS, {}, false, true);
    const fixMerge = resolveVerdictAction(FINDINGS, { 0: 'fix' }, true, true);
    expect(merge).toEqual({ reply: 'approveAndMerge', label: 'Approve and merge' });
    expect(fixMerge).toEqual({
      reply: 'fixFindingsApproveAndMerge',
      label: 'Fix 1 finding, approve and merge',
    });
    expect([isFixingAction(merge), isFixingAction(fixMerge)]).toEqual([false, true]);
    expect(isVerdictActionBlocked(true, merge)).toBe(true);
    expect(describeApproveHint(false, merge)).toBe(
      'Opens the pull request and merges it once CI is green, nothing conflicts and no comment is unread'
    );
    expect(describeApproveHint(true, merge)).toBe(
      'Send your line comments to the agent or remove them first'
    );
    expect(describeApproveHint(false, fixMerge)).toBe(
      'Sends the findings you kept, approves once the fix passes, then merges once the pull request is ready'
    );
    expect(describeApproveHint(true, fixMerge)).toBe(
      'Sends the findings you kept and your line comments, approves once the fix passes, then merges once the pull request is ready'
    );
  });

  it('lists the choices the engine supports, and none when only one is left', () => {
    const labels = (draft: Record<number, 'fix' | 'dismiss'>, support: typeof BOTH) =>
      listFollowUpChoices(FINDINGS, draft, support).map((choice) => choice.label);
    expect(labels({ 0: 'fix' }, BOTH)).toEqual([
      'Fix 1 finding',
      'Fix 1 finding and approve',
      'Fix 1 finding, approve and merge',
    ]);
    expect(labels({}, BOTH)).toEqual(['Approve changes', 'Approve and merge']);
    expect(labels({ 0: 'fix' }, { approveAfterFix: false, approveAndMerge: true })).toEqual([]);
    expect(labels({}, { approveAfterFix: false, approveAndMerge: true })).toEqual([
      'Approve changes',
      'Approve and merge',
    ]);
    expect(labels({ 0: 'fix' }, { approveAfterFix: true, approveAndMerge: false })).toEqual([
      'Fix 1 finding',
      'Fix 1 finding and approve',
    ]);
    expect(labels({}, { approveAfterFix: true, approveAndMerge: false })).toEqual([]);
  });

  it('reads the draft as one follow-up and back, and keeps only a choice on offer', () => {
    expect([
      resolveFollowUp(false, false),
      resolveFollowUp(true, false),
      resolveFollowUp(true, true),
    ]).toEqual(['none', 'approve', 'merge']);
    expect(resolveFollowUpFlags('merge')).toEqual({ thenApprove: true, thenMerge: true });
    expect(resolveFollowUpFlags('none')).toEqual({ thenApprove: false, thenMerge: false });
    const choices = listFollowUpChoices(FINDINGS, {}, BOTH);
    expect([resolveChosenFollowUp(choices, 'merge'), resolveChosenFollowUp(choices, 'approve')]).toEqual([
      'merge',
      'none',
    ]);
  });

  it('merges once ready only a task that merges and does not follow a bundle lead', () => {
    const lead = createTask({ id: 'lead' });
    const follower = createTask({ id: 'follower', stacksOn: ['lead'] });
    const question = createTask({ id: 'question', mode: 'ask' });
    const state = createShinsaState({ tasks: [lead, follower, question] });
    expect([lead, follower, question].map((task) => canMergeAhead(state, task))).toEqual([
      true,
      false,
      false,
    ]);
  });
});
