import { describe, expect, test } from 'bun:test';
import { describeHumanEdits, listOpenGates, resolveEditRefusal } from '../../src/index.ts';
import {
  approve,
  createHarness,
  createTask,
  failing,
  PASSING,
  pullRequest,
  pushed,
  pushFix,
  reachReviewGate,
  reachShipping,
  readInstruction,
} from '../harness.ts';

function edit(harness: ReturnType<typeof createHarness>, taskId: string, path: string, changed = true) {
  return harness.send({ type: 'task.record_edit', taskId, path, changed });
}

describe('your edits in the Code tab', () => {
  test('an edit is recorded once per file and shows in the activity', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    edit(harness, taskId, 'src/b.ts');
    edit(harness, taskId, 'src/a.ts');
    const again = edit(harness, taskId, 'src/a.ts');
    expect(again.events).toEqual([]);
    expect(harness.task(taskId).editedPaths).toEqual(['src/a.ts', 'src/b.ts']);
    expect(harness.task(taskId).untoldEdits).toEqual(['src/a.ts', 'src/b.ts']);
    expect(harness.task(taskId).activity.filter((entry) => entry.text.startsWith('Edited'))).toHaveLength(2);
  });

  test('a file put back the way it was committed is no longer an edit', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    edit(harness, taskId, 'src/a.ts');
    edit(harness, taskId, 'src/a.ts', false);
    expect(harness.task(taskId).editedPaths).toEqual([]);
    expect(harness.task(taskId).untoldEdits).toEqual([]);
    expect(edit(harness, taskId, 'src/a.ts', false).events).toEqual([]);
  });

  test('a working agent is told at once, and the next turn is told again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    edit(harness, taskId, 'src/a.ts');
    expect(harness.lastEffect('run.steer')).toEqual({
      kind: 'run.steer',
      runId: run.id,
      text: describeHumanEdits(['src/a.ts']),
    });
    const steers = harness.effectsOf('run.steer').length;
    edit(harness, taskId, 'src/a.ts', false);
    expect(harness.effectsOf('run.steer')).toHaveLength(steers);
  });

  test('the next agent turn lists the files you edited, once', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    edit(harness, taskId, 'src/a.ts');
    edit(harness, taskId, 'src/b.ts');
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Tidy it.',
    });
    const fix = harness.activeRun(taskId);
    expect(fix.prompt).toContain(describeHumanEdits(['src/a.ts', 'src/b.ts']));
    expect(readInstruction(fix)).toContain('Tidy it.');
    expect(harness.task(taskId).untoldEdits).toEqual([]);
    expect(harness.task(taskId).editedPaths).toEqual(['src/a.ts', 'src/b.ts']);
    harness.send({ type: 'agent.complete_fix', runId: fix.id, summary: 'Done.', treeHash: 'tree-2' });
    expect(harness.task(taskId).editedPaths).toEqual([]);
  });

  test('the edits committed before a push are no longer pending', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    expect(harness.send({ type: 'task.commit_edits', taskId, treeHash: 'tree-9' }).events).toEqual([]);
    edit(harness, taskId, 'src/a.ts');
    harness.send({ type: 'task.commit_edits', taskId, treeHash: 'tree-9' });
    expect(harness.task(taskId).editedPaths).toEqual([]);
    expect(harness.task(taskId).treeHash).toBe('tree-9');
    edit(harness, taskId, 'src/a.ts');
    harness.send({ type: 'task.commit_edits', taskId, treeHash: null });
    expect(harness.task(taskId).editedPaths).toEqual([]);
    expect(harness.task(taskId).treeHash).toBe('tree-9');
  });

  test('approving the review with edits commits them and runs the checks, then ships without asking again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    edit(harness, taskId, 'src/a.ts');
    approve(harness, taskId);
    expect(harness.task(taskId)).toMatchObject({
      stage: 'checking',
      stageReason: 'committing your edits and running the checks',
      approvedEdits: 'review',
    });
    expect(harness.lastEffect('checks.run').taskId).toBe(taskId);
    harness.send({ type: 'task.commit_edits', taskId, treeHash: 'tree-9' });
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'shipping',
      stageReason: 'opening the pull request',
      approvedEdits: null,
      pushPending: true,
    });
    expect(harness.lastEffect('pull_request.open').taskId).toBe(taskId);
    expect(listOpenGates(harness.state, taskId)).toEqual([]);
  });

  test('checks that fail after your edits go to a fix, and the work comes back to your review', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    edit(harness, taskId, 'src/a.ts');
    approve(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing() });
    expect(harness.task(taskId)).toMatchObject({ stage: 'fixing', fixFor: 'checks', approvedEdits: null });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Fixed.' });
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    expect(harness.activeRun(taskId).role).toBe('reviewer');
  });

  test('approving the merge with edits pushes them, waits for CI and merges once it passes', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    edit(harness, taskId, 'src/a.ts');
    approve(harness, taskId);
    expect(harness.task(taskId)).toMatchObject({
      stage: 'shipping',
      stageReason: 'pushing your edits',
      approvedEdits: 'merge',
    });
    expect(harness.lastEffect('pull_request.push').taskId).toBe(taskId);
    pushed(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'pending' }) });
    expect(harness.task(taskId).stageReason).toBe('waiting for CI');
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'awaiting_merge',
      stageReason: 'merging',
      approvedEdits: null,
    });
    expect(listOpenGates(harness.state, taskId)).toEqual([]);
    expect(harness.lastEffect('pull_request.merge').taskId).toBe(taskId);
  });

  test('CI that fails after your edits goes to a fix, and the merge gate opens again after it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    edit(harness, taskId, 'src/a.ts');
    approve(harness, taskId);
    pushed(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'failing' }) });
    expect(harness.task(taskId)).toMatchObject({ stage: 'fixing', approvedEdits: null });
    pushFix(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.openGate(taskId).type).toBe('merge');
  });

  test('a merged or finished task, or one with no checkout, refuses edits', () => {
    expect(resolveEditRefusal({ stage: 'merged', closedAt: null, worktreePath: '/w' })).toBe(
      'This task is merged, so its code is read-only.'
    );
    expect(resolveEditRefusal({ stage: 'cancelled', closedAt: null, worktreePath: '/w' })).toBe(
      'This task is finished, so its code is read-only.'
    );
    expect(resolveEditRefusal({ stage: 'done', closedAt: 5, worktreePath: '/w' })).toBe(
      'This task is finished, so its code is read-only.'
    );
    expect(resolveEditRefusal({ stage: 'building', closedAt: null, worktreePath: null })).toBe(
      'This task has no checkout to edit, so its code is read-only.'
    );
    expect(resolveEditRefusal({ stage: 'awaiting_review', worktreePath: '/w' } as never)).toBeNull();
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    pushed(harness, taskId);
    expect(() => edit(harness, taskId, 'src/a.ts')).toThrow('This task is merged, so its code is read-only.');
  });

  test('one file and several read as such to the agent', () => {
    expect(describeHumanEdits(['a.ts'])).toStartWith('The human edited this file in the working copy: a.ts.');
    expect(describeHumanEdits(['a.ts', 'b.ts'])).toStartWith(
      'The human edited these files in the working copy: a.ts, b.ts.'
    );
  });
});
