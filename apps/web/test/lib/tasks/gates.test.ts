import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { replyToGate, resolveApprovalReply, resolvePlanReply } from '@/lib/tasks/gates.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createPullRequest } from '../../support/pull-request.ts';
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
});
