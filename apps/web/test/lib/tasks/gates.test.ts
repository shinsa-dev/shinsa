import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  replyToGate,
  replyToTaskGate,
  resolveApprovalReply,
  resolvePlanReply,
  resolveReplyDone,
} from '@/lib/tasks/gates.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createPullRequest } from '../../support/pull-request.ts';
import { createRoundOntoOpenPullRequest } from '../../support/rounds.ts';
import { createGate, createTask } from '../../support/state.ts';

describe('resolvePlanReply', () => {
  it('says the operation runs next when an operation’s plan is approved, and building otherwise', () => {
    expect(resolvePlanReply(createTask({ id: 't', pipeline: ['plan', 'operate'] }))).toBe(
      'approveOperationPlan'
    );
    expect(resolvePlanReply(createTask({ id: 't', pipeline: ['plan', 'operate', 'build'] }))).toBe(
      'approveOperationPlan'
    );
    expect(resolvePlanReply(createTask({ id: 't', pipeline: ['plan', 'build', 'checks'] }))).toBe(
      'approvePlan'
    );
  });
});

describe('resolveApprovalReply', () => {
  it('says what approving really does with your uncommitted edits and an open pull request', () => {
    const review = createGate({ id: 'g', taskId: 't', type: 'review' });
    const merge = createGate({ id: 'g', taskId: 't', type: 'merge' });
    const task = createTask({
      id: 't',
      pipeline: ['plan', 'build', 'checks', 'your_review', 'pull_request', 'merge'],
    });
    const edited = { ...task, editedPaths: ['src/a.ts'] };
    expect(resolveApprovalReply(task, review, 'approveChanges')).toBe('approveChanges');
    expect(resolveApprovalReply(edited, review, 'approveChanges')).toBe('approveEdits');
    expect(
      resolveApprovalReply(
        { ...task, pullRequest: createPullRequest({ number: 4 }) },
        review,
        'approveChanges'
      )
    ).toBe('pushChanges');
    expect(resolveApprovalReply(task, merge, 'merge')).toBe('merge');
    expect(resolveApprovalReply(edited, merge, 'merge')).toBe('mergeEdits');
    expect(resolveApprovalReply(edited, review, 'fixFindings')).toBe('fixFindings');
  });
});

describe('replyToGate', () => {
  let spies: ReturnType<typeof spyOnCommands>;

  beforeEach(() => {
    spies = spyOnCommands();
  });

  afterEach(() => {
    spies.restore();
  });

  it('asks for the approval after the fix only when you fix and approve', async () => {
    const review = createGate({ id: 'g', taskId: 't', type: 'review' });
    await replyToGate(review, 'fixFindingsAndApprove');
    await replyToGate(review, 'fixFindings');
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'gate.answer', gateId: 'g', decision: 'revise', response: null, thenApprove: true },
        'Sent. Approving once the fix passes.',
      ],
      [
        { type: 'gate.answer', gateId: 'g', decision: 'revise', response: null },
        'Sent. The agent works on what you kept.',
      ],
    ]);
  });

  it('says a later round’s close brings back the earlier merge, and the task is done otherwise', async () => {
    const later = createTask({ id: 't', rounds: createRoundOntoOpenPullRequest(276) });
    const alone = createTask({ id: 't' });
    expect(resolveReplyDone(later, 'closeProposal')).toBe('Round closed. Back to #276.');
    expect(resolveReplyDone(later, 'keepAsIs')).toBe('Round closed. Back to #276.');
    expect(resolveReplyDone(later, 'closeResult')).toBe('Round closed. Back to #276.');
    expect(resolveReplyDone(later, 'makeChange')).toBe('Approved. Planning the change now.');
    expect(resolveReplyDone(alone, 'closeProposal')).toBe('Closed. The task is done.');
    await replyToTaskGate(later, createGate({ id: 'g', taskId: 't', type: 'proposal' }), 'closeProposal');
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'gate.answer', gateId: 'g', decision: 'reject', response: null },
        'Round closed. Back to #276.',
      ],
    ]);
  });

  it('sends the repository you picked as the reply to the setup question', async () => {
    const setup = createGate({ id: 'g', taskId: 't', type: 'configuration', choices: ['paywall-next'] });
    await replyToGate(setup, 'pickRepository', 'paywall-next');
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'gate.answer', gateId: 'g', decision: 'reply', response: 'paywall-next' },
        'Checking that repository.',
      ],
    ]);
  });
});
