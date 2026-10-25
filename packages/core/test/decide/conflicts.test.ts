import { describe, expect, test } from 'bun:test';
import { listActiveRuns, listOpenGates } from '../../src/index.ts';
import {
  approve,
  buildAll,
  completePhase,
  createHarness,
  createTask,
  linkSession,
  PASSING,
  proposePlan,
  pullRequest,
  pushed,
  reachReviewGate,
  reachShipping,
  registerRepo,
} from '../harness.ts';

function conflict(harness: ReturnType<typeof createHarness>, taskId: string) {
  return harness.send({ type: 'task.record_conflict', taskId, branch: `fix/${taskId}` });
}

function linkedTask() {
  const harness = createHarness();
  const taskId = createTask(harness);
  proposePlan(harness, taskId);
  linkSession(harness, taskId, 'agent-session');
  return { harness, taskId };
}

describe('commits GitButler left conflicted', () => {
  test('at the review gate the agent resolves them in its own session, then the checks and review run again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    linkSession(harness, taskId, 'agent-session');
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({ type: 'agent.report_review', runId: harness.activeRun(taskId).id, findings: [] });
    expect(harness.openGate(taskId).type).toBe('review');

    conflict(harness, taskId);
    const run = harness.activeRun(taskId);
    expect(listOpenGates(harness.state, taskId)).toEqual([]);
    expect(harness.task(taskId)).toMatchObject({
      stage: 'fixing',
      stageReason: 'resolving conflicts',
      fixFor: 'conflict',
    });
    expect(run).toMatchObject({ role: 'agent', purpose: 'fix', sessionId: 'agent-session', resume: true });
    expect(run.prompt).toContain(`but resolve conflicts fix/${taskId}`);
    expect(run.prompt).toContain('Never run `but resolve <commit>`');
    expect(harness.task(taskId).activity.at(-1)?.text).toBe(
      'Fix round 1: resolving the conflicts GitButler left'
    );

    harness.send({ type: 'agent.complete_fix', runId: run.id, summary: 'Kept both lines.' });
    expect(harness.task(taskId).stage).toBe('checking');
  });

  test('with the pull request open the merge gate is withdrawn and the resolved branch is pushed', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.openGate(taskId).type).toBe('merge');

    conflict(harness, taskId);
    expect(listOpenGates(harness.state, taskId)).toEqual([]);
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Resolved.' });
    expect(harness.task(taskId)).toMatchObject({ stage: 'shipping', stageReason: 'pushing the fix' });
    expect(harness.lastEffect('pull_request.push').taskId).toBe(taskId);
  });

  test('a push Shinsa held back because of them is asked for again once they are resolved', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    approve(harness, taskId);
    expect(harness.task(taskId).pushPending).toBe(true);

    conflict(harness, taskId);
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Resolved.' });
    expect(harness.effectsOf('pull_request.open')).toHaveLength(2);
    pushed(harness, taskId);
    expect(harness.task(taskId).pushPending).toBe(false);
  });

  test('an agent at work is told to resolve them before it hands over', () => {
    const { harness, taskId } = linkedTask();
    const run = harness.activeRun(taskId);
    expect(run.purpose).toBe('build');
    const decision = conflict(harness, taskId);
    expect(decision.events).toEqual([]);
    const steer = harness.lastEffect('run.steer');
    expect(steer.runId).toBe(run.id);
    expect(steer.text).toContain('Resolve them before you hand over.');
    expect(harness.task(taskId).stage).toBe('building');
  });

  test('a task that is planning, reviewing or merging keeps the conflict for its next gate; a settled one or another branch records nothing', () => {
    const harness = createHarness();
    const planning = createTask(harness);
    expect(conflict(harness, planning).events).toMatchObject([
      { type: 'task.conflict_held', branch: `fix/${planning}` },
    ]);
    expect(conflict(harness, planning).events).toEqual([]);

    const reviewing = createTask(harness);
    buildAll(harness, reviewing);
    harness.send({ type: 'checks.record', taskId: reviewing, results: PASSING });
    expect(harness.task(reviewing).stage).toBe('reviewing');
    conflict(harness, reviewing);
    expect(harness.task(reviewing)).toMatchObject({ stage: 'reviewing', heldConflict: `fix/${reviewing}` });

    const merging = createTask(harness);
    reachShipping(harness, merging);
    harness.send({ type: 'pull_request.record', taskId: merging, pullRequest: pullRequest() });
    approve(harness, merging);
    conflict(harness, merging);
    expect(harness.task(merging)).toMatchObject({ stage: 'awaiting_merge', heldConflict: `fix/${merging}` });

    expect(
      harness.send({ type: 'task.record_conflict', taskId: merging, branch: 'feat/other' }).events
    ).toEqual([]);
    harness.send({ type: 'task.cancel', taskId: planning });
    expect(conflict(harness, planning).events).toEqual([]);
  });

  test('a conflict held while reviewing starts the fix where the review gate would open', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    conflict(harness, taskId);
    harness.send({ type: 'agent.report_review', runId: harness.activeRun(taskId).id, findings: [] });
    expect(listOpenGates(harness.state, taskId)).toEqual([]);
    expect(harness.task(taskId)).toMatchObject({ stage: 'fixing', fixFor: 'conflict', heldConflict: null });
    const { prompt = '' } = harness.activeRun(taskId);
    expect(prompt.split(`but resolve conflicts fix/${taskId}`)).toHaveLength(2);
  });

  test('a conflict held while the merge runs starts the fix where the merge gate would open again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    approve(harness, taskId);
    conflict(harness, taskId);
    harness.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: pullRequest({ mergeQueue: { state: 'queued', position: 1 } }),
    });
    expect(harness.task(taskId).stage).toBe('awaiting_merge');
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.task(taskId)).toMatchObject({ stage: 'fixing', fixFor: 'conflict', heldConflict: null });
  });

  test('a conflict found while planning is told to the agent at its first build turn, then no longer held', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    conflict(harness, taskId);
    expect(harness.task(taskId).heldConflict).toBe(`fix/${taskId}`);
    proposePlan(harness, taskId);
    const build = harness.activeRun(taskId);
    expect(build.purpose).toBe('build');
    expect(build.prompt).toContain(`but resolve conflicts fix/${taskId}`);
    expect(build.prompt).toEndWith('Resolve them before you hand over.');
    expect(build.rolePrompt).not.toContain('but resolve');
    expect(harness.task(taskId)).toMatchObject({ stage: 'building', heldConflict: null });

    completePhase(harness, taskId);
    expect(harness.activeRun(taskId).prompt).not.toContain('but resolve');
    conflict(harness, taskId);
    expect(harness.task(taskId).heldConflict).toBeNull();
    expect(harness.lastEffect('run.steer').text).toContain('Resolve them before you hand over.');
  });

  test('a conflict held while reviewing is told at the fix turn the review starts', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    conflict(harness, taskId);
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      findings: [{ severity: 'blocking', file: 'src/a.ts', line: 3, message: 'Off by one.' }],
    });
    const fix = harness.activeRun(taskId);
    expect(fix).toMatchObject({ role: 'agent', purpose: 'fix' });
    expect(fix.prompt).toEndWith('Resolve them before you hand over.');
    expect(harness.task(taskId)).toMatchObject({ fixFor: 'review', heldConflict: null });
  });

  test('conflicts the agent leaves unresolved twice stop at a failure gate', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    for (let round = 0; round < 3; round += 1) {
      conflict(harness, taskId);
      if (harness.task(taskId).stage !== 'fixing') break;
      harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Tried.' });
      pushed(harness, taskId);
    }
    expect(harness.openGate(taskId)).toMatchObject({
      type: 'failure',
      title: 'Fixing is not making progress',
    });
  });
});

describe('a GitButler pull request that conflicts with its base', () => {
  function shipInGitButler() {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    harness.send({ type: 'repo.update', repoId, patch: { workspace: 'gitbutler' } });
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    return { harness, taskId };
  }

  test('opens a gate whose one action updates the workspace, then the agent resolves the rest and Shinsa pushes', () => {
    const { harness, taskId } = shipInGitButler();
    const conflicting = pullRequest({ mergeable: false, base: 'main', headSha: 'head-1' });
    harness.send({ type: 'pull_request.record', taskId, pullRequest: conflicting });
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({
      type: 'failure',
      cause: 'workspace_update',
      title: 'Pull request #42 conflicts with main',
    });
    expect(gate.body).toContain('only `but pull` brings in main');
    expect(harness.task(taskId).stageReason).toBe('waiting for you to update the workspace');
    expect(listActiveRuns(harness.state, taskId)).toEqual([]);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: conflicting });
    expect(harness.openGate(taskId).id).toBe(gate.id);

    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'reply', response: 'Keep main’s copy.' });
    expect(harness.task(taskId)).toMatchObject({ stage: 'shipping', stageReason: 'updating the workspace' });
    expect(harness.lastEffect('workspace.update')).toEqual({
      kind: 'workspace.update',
      taskId,
      guidance: 'Keep main’s copy.',
    });
    harness.send({ type: 'pull_request.record', taskId, pullRequest: conflicting });
    expect(listOpenGates(harness.state, taskId)).toEqual([]);

    harness.send({ type: 'task.record_workspace_update', taskId, guidance: 'Keep main’s copy.' });
    const run = harness.activeRun(taskId);
    expect(harness.task(taskId)).toMatchObject({ stage: 'fixing', fixFor: 'conflict' });
    expect(run).toMatchObject({ role: 'agent', purpose: 'fix' });
    expect(run.prompt).toContain('Shinsa updated their GitButler workspace with `but pull`');
    expect(run.prompt).toContain('Guidance from the human: Keep main’s copy.');
    expect(harness.send({ type: 'task.record_workspace_update', taskId, guidance: null }).events).toEqual([]);

    harness.send({ type: 'agent.complete_fix', runId: run.id, summary: 'Nothing left conflicted.' });
    expect(harness.task(taskId)).toMatchObject({ stage: 'shipping', stageReason: 'pushing the fix' });
    expect(harness.lastEffect('pull_request.push').taskId).toBe(taskId);
  });

  test('approving updates without guidance; a clean pull request withdraws the gate; rejecting cancels', () => {
    const { harness, taskId } = shipInGitButler();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ mergeable: false }) });
    expect(harness.openGate(taskId).title).toBe('Pull request #42 conflicts with its base');
    approve(harness, taskId);
    expect(harness.lastEffect('workspace.update').guidance).toBeNull();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.openGate(taskId).type).toBe('merge');
    expect(harness.send({ type: 'task.record_workspace_update', taskId, guidance: null }).events).toEqual([]);

    const other = shipInGitButler();
    other.harness.send({
      type: 'pull_request.record',
      taskId: other.taskId,
      pullRequest: pullRequest({ mergeable: false }),
    });
    other.harness.send({
      type: 'gate.answer',
      gateId: other.harness.openGate(other.taskId).id,
      decision: 'reject',
      response: null,
    });
    expect(other.harness.task(other.taskId).stage).toBe('cancelled');
  });

  test('a `but pull` that fails pauses the task, and retrying runs it again', () => {
    const { harness, taskId } = shipInGitButler();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ mergeable: false }) });
    approve(harness, taskId);
    harness.send({
      type: 'effect.fail',
      taskId,
      title: 'Could not update the workspace',
      detail: 'No network.',
    });
    expect(harness.openGate(taskId)).toMatchObject({
      type: 'failure',
      title: 'Could not update the workspace',
    });
    harness.send({ type: 'task.retry', taskId });
    expect(harness.effectsOf('workspace.update')).toHaveLength(2);
    expect(harness.task(taskId).stageReason).toBe('updating the workspace');
  });
});
