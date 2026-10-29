import { describe, expect, test } from 'bun:test';
import { PULL_REQUEST_READ_FAILURE_LIMIT } from '../../src/decide/watch.ts';
import {
  CI_GRACE_MS,
  listActiveRuns,
  listOpenGates,
  type PullRequest,
  type PullRequestRemark,
  type RepoCi,
  replayEventLog,
  type ShinsaCommand,
} from '../../src/index.ts';
import {
  approve,
  buildAll,
  checkResult,
  createHarness,
  createTask,
  type Harness,
  proposePlan,
  pullRequest,
  pushed,
  pushFix,
  reachReviewGate,
  reachShipping,
} from '../harness.ts';

function shipping() {
  const harness = createHarness();
  const taskId = createTask(harness);
  reachShipping(harness, taskId);
  return { harness, taskId };
}

describe('opening the pull request', () => {
  test('approving the review asks for a push and opens the pull request', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    approve(harness, taskId);
    expect(harness.task(taskId)).toMatchObject({
      stage: 'shipping',
      stageReason: 'opening the pull request',
    });
    expect(harness.task(taskId).pushPending).toBe(true);
    expect(harness.lastEffect('pull_request.open').taskId).toBe(taskId);
    pushed(harness, taskId, 'abc');
    expect(harness.task(taskId)).toMatchObject({ pushPending: false, pushedSha: 'abc' });
  });

  test('a recorded pull request is opened once and updated after that', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'pending' }) });
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'pending' }) });
    const opened = harness.task(taskId).activity.filter((entry) => entry.kind === 'pull_request');
    expect(opened.map((entry) => entry.text)).toEqual(['Opened pull request #42']);
  });
});

describe('a push reported twice', () => {
  test('the same commit reported pushed again changes nothing', () => {
    const { harness, taskId } = shipping();
    const sha = harness.task(taskId).pushedSha ?? '';
    expect(sha).not.toBe('');
    expect(harness.send({ type: 'pull_request.record_push', taskId, sha }).events).toEqual([]);
  });
});

describe('reacting to the pull request', () => {
  test('a clean pull request opens the merge gate; a failing one is fixed and pushed', () => {
    const { harness, taskId } = shipping();
    harness.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: pullRequest({ checks: 'pending', mergeable: null }),
    });
    expect(harness.task(taskId).stageReason).toBe('waiting for CI');
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);

    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'failing' }) });
    expect(harness.task(taskId).fixFor).toBe('pull_request');
    expect(harness.activeRun(taskId).prompt).toContain('CI checks are failing');
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Fixed CI.' });
    expect(harness.task(taskId)).toMatchObject({ stage: 'shipping', stageReason: 'pushing the fix' });
    expect(harness.lastEffect('pull_request.push').taskId).toBe(taskId);
    pushed(harness, taskId);

    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.task(taskId).stage).toBe('awaiting_merge');
    approve(harness, taskId);
    expect(harness.task(taskId).stageReason).toBe('merging');
    expect(harness.lastEffect('pull_request.merge').taskId).toBe(taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    expect(harness.task(taskId).stage).toBe('merged');
    expect(harness.lastEffect('worktree.remove').taskId).toBe(taskId);
  });

  test('a pull request in a repository without CI reaches the merge gate', () => {
    const { harness, taskId } = shipping();
    harness.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: pullRequest({ checks: 'none' }),
      ci: 'none',
    });
    expect(harness.openGate(taskId).type).toBe('merge');
  });

  test('conflicts and unresolved comments are fixed too', () => {
    const { harness, taskId } = shipping();
    harness.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: pullRequest({ mergeable: false, unresolvedComments: 2 }),
    });
    const prompt = harness.activeRun(taskId).prompt ?? '';
    expect(prompt).toContain('2 unresolved review comments');
    expect(prompt).toContain('merge conflicts');
  });

  test('a pull request that conflicts with its base goes straight to the agent to resolve, in every workspace', () => {
    for (const [workspace, base, reason] of [
      ['worktrees', 'main', 'resolving conflicts with main'],
      ['main_checkout', undefined, 'resolving conflicts with the base branch'],
    ] as const) {
      const { harness, taskId } = shipping();
      const repoId = harness.task(taskId).repoId ?? '';
      harness.send({ type: 'repo.update', repoId, patch: { workspace } });
      harness.send({
        type: 'pull_request.record',
        taskId,
        pullRequest: pullRequest({ mergeable: false, checks: 'pending', base }),
      });
      expect(harness.task(taskId)).toMatchObject({
        stage: 'fixing',
        fixFor: 'conflict',
        stageReason: reason,
      });
      expect(listOpenGates(harness.state, taskId)).toEqual([]);
      expect(harness.activeRun(taskId).prompt).toContain('The pull request conflicts with');
      harness.send({
        type: 'agent.complete_fix',
        runId: harness.activeRun(taskId).id,
        summary: 'Merged main.',
      });
      expect(harness.task(taskId)).toMatchObject({ stage: 'shipping', pushPending: true });
    }
  });

  test('a pull request that keeps failing while its fixes change nothing stops after two fix rounds', () => {
    const { harness, taskId } = shipping();
    for (let round = 0; round < 4; round += 1) {
      harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'failing' }) });
      if (harness.task(taskId).stage !== 'fixing') break;
      harness.send({
        type: 'agent.complete_fix',
        runId: harness.activeRun(taskId).id,
        summary: 'Tried.',
        treeHash: 'same-tree',
      });
      pushed(harness, taskId);
    }
    const gate = harness.openGate(taskId);
    expect(gate.type).toBe('failure');
    expect(gate.body).toBe(
      'The same problems came back after 2 fix rounds. Steer the agent in the chat, or retry.'
    );
  });

  test('a record that arrives while the fix is still being pushed is not judged', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'failing' }) });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Fixed CI.' });
    const rounds = harness.task(taskId).fixRounds;
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'failing' }) });
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    expect(harness.task(taskId)).toMatchObject({ stageReason: 'pushing the fix', fixRounds: rounds });
    pushed(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.openGate(taskId).type).toBe('merge');
  });

  test('a pull request that has not seen the pushed commit yet is not judged', () => {
    const { harness, taskId } = shipping();
    harness.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: pullRequest({ checks: 'failing', headSha: 'old' }),
    });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Fixed CI.' });
    pushed(harness, taskId, 'new');
    harness.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: pullRequest({ checks: 'failing', headSha: 'old' }),
    });
    expect(harness.task(taskId).stageReason).toBe('waiting for GitHub to see the push');
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ headSha: 'new' }) });
    expect(harness.openGate(taskId).type).toBe('merge');
  });

  test('a commit someone else pushes while the merge gate is open takes the gate back until it is judged', () => {
    const { harness, taskId } = shipping();
    pushed(harness, taskId, 'ours');
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ headSha: 'ours' }) });
    expect(harness.openGate(taskId).type).toBe('merge');
    harness.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: pullRequest({ headSha: 'theirs1', checks: 'pending', mergeable: null }),
    });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(harness.task(taskId)).toMatchObject({ pushedSha: 'theirs1', stageReason: 'waiting for CI' });
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      'The branch moved to theirs1, a commit Shinsa did not push'
    );
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ headSha: 'theirs1' }) });
    expect(harness.openGate(taskId).type).toBe('merge');
  });

  test('a first read that already shows someone else’s commit on top of the push is judged, not waited on', () => {
    const { harness, taskId } = shipping();
    pushed(harness, taskId, 'ours');
    harness.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: pullRequest({ headSha: 'bot-commit' }),
    });
    expect(harness.task(taskId).pushedSha).toBe('bot-commit');
    expect(harness.openGate(taskId).type).toBe('merge');
  });

  test('a sync while the merge runs does not open the merge gate again', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    approve(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ mergeable: null }) });
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.task(taskId)).toMatchObject({ stage: 'awaiting_merge', stageReason: 'merging' });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });

  test('a clean pull request clears a failure the loop left behind', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'effect.fail', taskId, title: 'Could not read the pull request', detail: 'gh' });
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(listOpenGates(harness.state, taskId).map((gate) => gate.type)).toEqual(['merge']);
  });

  test('a closed pull request cancels the task, and later records are ignored', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'closed' }) });
    expect(harness.task(taskId).stage).toBe('cancelled');
    const events = harness.state.seq;
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    pushed(harness, taskId);
    expect(harness.state.seq).toBe(events);
  });

  test('a record for a task that is not shipping only stores the pull request', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.task(taskId)).toMatchObject({ stage: 'planning', pullRequest: { number: 42 } });
  });
});

describe('retrying a pull request step', () => {
  test('retrying a failed pull request open opens it again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    approve(harness, taskId);
    harness.send({ type: 'effect.fail', taskId, title: 'Could not open the pull request', detail: 'auth' });
    const before = harness.effectsOf('pull_request.open').length;
    approve(harness, taskId);
    expect(harness.effectsOf('pull_request.open')).toHaveLength(before + 1);
  });

  test('retrying a failed push pushes again instead of reading the stale pull request', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'pending' }) });
    harness.send({ type: 'effect.fail', taskId, title: 'Could not push the fixes', detail: 'rejected' });
    const before = harness.effectsOf('pull_request.push').length;
    approve(harness, taskId);
    expect(harness.effectsOf('pull_request.push')).toHaveLength(before + 1);
  });

  test('retrying a failed merge checks the pull request again instead of pushing', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    approve(harness, taskId);
    harness.send({
      type: 'effect.fail',
      taskId,
      title: 'Could not merge the pull request',
      detail: 'blocked',
    });
    const pushes = harness.effectsOf('pull_request.push').length;
    approve(harness, taskId);
    expect(harness.effectsOf('pull_request.push')).toHaveLength(pushes);
    expect(harness.lastEffect('pull_request.watch').taskId).toBe(taskId);
    expect(harness.task(taskId)).toMatchObject({
      stage: 'shipping',
      stageReason: 'checking the pull request',
    });
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.openGate(taskId).type).toBe('merge');
  });

  test('retrying while the merge gate is open checks the pull request again', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    harness.send({ type: 'effect.fail', taskId, title: 'Could not read the pull request', detail: 'gh' });
    harness.send({ type: 'task.retry', taskId });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(harness.task(taskId).stage).toBe('shipping');
  });
});

describe('waiting on other tasks after building started', () => {
  test('a dependency added after building started only holds the merge gate', () => {
    const harness = createHarness();
    const base = createTask(harness, { request: 'Base' });
    const top = createTask(harness, { request: 'Top' });
    reachReviewGate(harness, top);
    harness.send({ type: 'task.wait_on', taskId: top, waitsOn: [base] });
    expect(harness.task(top)).toMatchObject({ waitsOn: [base], stage: 'awaiting_review' });
    approve(harness, top);
    pushed(harness, top);
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest({ number: 2 }) });
    expect(harness.task(top).stageReason).toBe('waiting for “Base” to merge');
    expect(listOpenGates(harness.state, top)).toHaveLength(0);

    harness.send({
      type: 'pull_request.record',
      taskId: base,
      pullRequest: pullRequest({ state: 'merged' }),
    });
    expect(harness.effectsOf('pull_request.watch').map((effect) => effect.taskId)).toContain(top);
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest({ number: 2 }) });
    expect(harness.task(top).stage).toBe('awaiting_merge');
  });

  test('a dependency added while the merge gate is open takes the gate back', () => {
    const harness = createHarness();
    const base = createTask(harness, { request: 'Base' });
    const top = createTask(harness, { request: 'Top' });
    reachShipping(harness, top);
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest() });
    expect(harness.openGate(top).type).toBe('merge');
    harness.send({ type: 'task.wait_on', taskId: top, waitsOn: [base] });
    expect(listOpenGates(harness.state, top)).toHaveLength(0);
    expect(harness.task(top)).toMatchObject({
      stage: 'shipping',
      stageReason: 'waiting for “Base” to merge',
    });
    harness.send({ type: 'task.wait_on', taskId: top, waitsOn: [] });
    expect(harness.lastEffect('pull_request.watch').taskId).toBe(top);
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest() });
    expect(harness.openGate(top).type).toBe('merge');
  });

  test('a dependency added while the merge runs leaves the merge alone', () => {
    const harness = createHarness();
    const base = createTask(harness, { request: 'Base' });
    const top = createTask(harness, { request: 'Top' });
    reachShipping(harness, top);
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest() });
    approve(harness, top);
    const watches = harness.effectsOf('pull_request.watch').length;
    harness.send({ type: 'task.wait_on', taskId: top, waitsOn: [base] });
    expect(harness.task(top).stageReason).toBe('merging');
    expect(harness.effectsOf('pull_request.watch')).toHaveLength(watches);
  });

  test('cancelling the task it waits on lets its pull request be judged again', () => {
    const harness = createHarness();
    const base = createTask(harness, { request: 'Base' });
    const top = createTask(harness, { request: 'Top' });
    reachShipping(harness, top);
    harness.send({ type: 'task.wait_on', taskId: top, waitsOn: [base] });
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest() });
    expect(harness.task(top).stageReason).toBe('waiting for “Base” to merge');
    harness.send({ type: 'task.cancel', taskId: base });
    expect(harness.lastEffect('pull_request.watch').taskId).toBe(top);
    harness.send({ type: 'pull_request.record', taskId: top, pullRequest: pullRequest() });
    expect(harness.openGate(top).type).toBe('merge');
  });
});

const REMARK = {
  id: 'c1',
  author: 'coderabbitai[bot]',
  createdAt: '2026-10-02T12:00:00Z',
  editedAt: null,
  body: 'Rename `foo` to `bar`.',
  path: 'src/a.ts',
  url: 'https://github.com/o/r/pull/42#c1',
  reviewState: null,
};

function failReads(harness: Harness, taskId: string, count: number, detail: string) {
  const events: { type: string }[] = [];
  for (let read = 0; read < count; read += 1) {
    events.push(...harness.send({ type: 'pull_request.read_failed', taskId, detail }).events);
  }
  return events;
}

function record(
  harness: Harness,
  taskId: string,
  overrides: Partial<PullRequest> = {},
  remarks: PullRequestRemark[] | null = []
) {
  return harness.send({
    type: 'pull_request.record',
    taskId,
    pullRequest: pullRequest(overrides),
    remarks,
    viewer: 'shinsa-user',
  });
}

describe('watching the pull request', () => {
  test('a new comment holds the merge gate and the agent reads it; once read, the clean pull request reaches the merge gate', () => {
    const { harness, taskId } = shipping();
    record(harness, taskId, {}, [REMARK]);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    const prompt = harness.activeRun(taskId).prompt ?? '';
    expect(prompt).toContain('New since Shinsa last looked:');
    expect(prompt).toContain('- 1 new comment:');
    expect(prompt).toContain('coderabbitai[bot] on src/a.ts: "Rename `foo` to `bar`."');
    expect(harness.task(taskId).fixSignature).toBeNull();
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      '1 new comment on the pull request'
    );
    pushFix(harness, taskId);
    record(harness, taskId, {}, [REMARK]);
    expect(harness.openGate(taskId).type).toBe('merge');
  });

  test('the reader’s own replies never start the agent', () => {
    const { harness, taskId } = shipping();
    record(harness, taskId, {}, [{ ...REMARK, author: 'shinsa-user' }]);
    expect(harness.openGate(taskId).type).toBe('merge');
  });

  test('a read that missed comments never moves the watermark past them', () => {
    const { harness, taskId } = shipping();
    record(harness, taskId, {}, null);
    expect(harness.openGate(taskId).type).toBe('merge');
    expect(harness.task(taskId).pullRequestWatch?.remarksThrough).toBe('1970-01-01T00:00:00.000Z');
    record(harness, taskId, {}, [REMARK]);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(harness.task(taskId).stage).toBe('fixing');
  });

  test('a check that newly fails is named with its link, and the next check to fail is new progress, not a stall', () => {
    const { harness, taskId } = shipping();
    const failing = (name: string) => ({
      checks: 'failing' as const,
      checkRuns: [{ name, status: 'failure' as const, required: true, url: `https://ci/${name}` }],
    });
    for (const name of ['lint', 'test', 'build']) {
      record(harness, taskId, failing(name));
      expect(harness.activeRun(taskId).prompt).toContain(`  - ${name} https://ci/${name}`);
      pushFix(harness, taskId);
    }
    expect(harness.task(taskId).fixFingerprints?.map((fingerprint) => fingerprint.signature)).toEqual([
      'check:lint',
      'check:test',
      'check:build',
    ]);
  });

  test('failing reads without check names are a stall only when the fix left the tree unchanged', () => {
    const { harness, taskId } = shipping();
    const fixOn = (treeHash: string) => {
      harness.send({
        type: 'agent.complete_fix',
        runId: harness.activeRun(taskId).id,
        summary: 'x',
        treeHash,
      });
      pushed(harness, taskId);
    };
    for (const tree of ['t1', 't2', 't3']) {
      record(harness, taskId, { checks: 'failing', headSha: `head-${tree}` });
      expect(harness.task(taskId).stage).toBe('fixing');
      fixOn(tree);
    }
    expect(harness.task(taskId).fixFingerprints?.map((fingerprint) => fingerprint.signature)).toEqual([
      null,
      null,
      null,
    ]);
    for (const head of ['head-a', 'head-b', 'head-c']) {
      record(harness, taskId, { checks: 'failing', headSha: head });
      if (harness.task(taskId).stage !== 'fixing') break;
      fixOn('t3');
    }
    expect(harness.openGate(taskId).title).toBe('Fixing is not making progress');
  });

  test('ten updates in a row that only bring comments stop the watch; retrying watches again', () => {
    const { harness, taskId } = shipping();
    for (let wake = 0; wake < 10; wake += 1) {
      record(harness, taskId, {}, [
        { ...REMARK, id: `c${wake}`, createdAt: `2026-10-02T12:00:${String(wake).padStart(2, '0')}Z` },
      ]);
      if (harness.task(taskId).stage !== 'fixing') break;
      pushFix(harness, taskId);
    }
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({ type: 'failure', title: 'Stopped watching the pull request' });
    expect(gate.body).toContain('after 10 updates in a row that brought only new comments');
    expect(harness.task(taskId).pullRequestWatch).toMatchObject({ stopped: 'comment_limit', wakes: 10 });
    record(harness, taskId, { checks: 'failing' });
    expect(harness.openGate(taskId).id).toBe(gate.id);
    approve(harness, taskId);
    expect(harness.task(taskId).pullRequestWatch).toMatchObject({ stopped: null, wakes: 0 });
  });

  test('a clean pull request restarts a stopped watch and opens the merge gate', () => {
    const { harness, taskId } = shipping();
    record(harness, taskId, { checks: 'pending' });
    failReads(harness, taskId, 8, 'HTTP 502.');
    expect(harness.task(taskId).pullRequestWatch?.stopped).toBe('unreadable');
    expect(harness.task(taskId).stageReason).toBe('waiting for CI');
    record(harness, taskId, { checks: 'pending', mergeable: false, base: 'main' });
    expect(harness.task(taskId)).toMatchObject({ stage: 'shipping', stageReason: 'conflicts with main' });
    record(harness, taskId, { checks: 'pending', mergeable: false });
    expect(harness.task(taskId).stageReason).toBe('conflicts with the base branch');
    record(harness, taskId);
    expect(harness.openGate(taskId).type).toBe('merge');
    expect(harness.task(taskId).pullRequestWatch?.stopped).toBeNull();
  });

  test('an identical record changes nothing', () => {
    const { harness, taskId } = shipping();
    record(harness, taskId, { checks: 'pending' });
    const seq = harness.state.seq;
    expect(record(harness, taskId, { checks: 'pending', updatedAt: 99 }).events).toEqual([]);
    expect(harness.state.seq).toBe(seq);
  });

  test('passed checks and a new conflict show in the task’s activity', () => {
    const { harness, taskId } = shipping();
    record(harness, taskId, {
      checkRuns: [{ name: 'ci', status: 'success', required: true, url: null }],
      mergeable: false,
    });
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      'All 1 required check passed on GitHub. The branch now conflicts with its base'
    );
  });
});

describe('a pull request GitHub cannot read', () => {
  test('counts failed reads in the log and stops the watch with a failure gate at the eighth, once', () => {
    const { harness, taskId } = shipping();
    record(harness, taskId, { checks: 'pending' });
    failReads(harness, taskId, PULL_REQUEST_READ_FAILURE_LIMIT - 1, 'HTTP 502.');
    expect(harness.task(taskId).pullRequestReadFailures).toBe(PULL_REQUEST_READ_FAILURE_LIMIT - 1);
    expect(listOpenGates(harness.state, taskId)).toEqual([]);
    failReads(harness, taskId, 1, 'HTTP 502.');
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({ type: 'failure', title: 'Could not read the pull request' });
    expect(gate.body).toBe(
      'Shinsa failed to read pull request #42 from GitHub 8 times in a row: HTTP 502. Check it on GitHub, then retry to watch it again.'
    );
    expect(harness.send({ type: 'pull_request.read_failed', taskId, detail: 'x' }).events).toEqual([]);
    record(harness, taskId, { checks: 'failing' });
    expect(harness.task(taskId).pullRequestReadFailures).toBe(0);
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    approve(harness, taskId);
    expect(harness.task(taskId).pullRequestWatch?.stopped).toBeNull();
  });

  test('the count survives a replay of the log, so a restart does not reset it', () => {
    const { harness, taskId } = shipping();
    record(harness, taskId, { checks: 'pending' });
    failReads(harness, taskId, 5, 'HTTP 502.');
    const replayed = replayEventLog(harness.events).state;
    expect(replayed.tasks[taskId]?.pullRequestReadFailures).toBe(5);
  });

  test('a good read, or retrying after the watch stopped, starts the count again', () => {
    const { harness, taskId } = shipping();
    record(harness, taskId, { checks: 'pending' });
    failReads(harness, taskId, 3, 'HTTP 502.');
    record(harness, taskId, { checks: 'pending' });
    expect(harness.task(taskId).pullRequestReadFailures).toBe(0);
    failReads(harness, taskId, PULL_REQUEST_READ_FAILURE_LIMIT, 'HTTP 502.');
    expect(harness.openGate(taskId).title).toBe('Could not read the pull request');
    harness.send({ type: 'task.retry', taskId });
    expect(harness.task(taskId).pullRequestReadFailures).toBe(0);
    failReads(harness, taskId, 1, 'HTTP 502.');
    expect(listOpenGates(harness.state, taskId)).toEqual([]);
  });

  test('keeps counting but waits while an agent works on it or you decide the merge, and ignores a task without a pull request', () => {
    const { harness, taskId } = shipping();
    expect(failReads(harness, taskId, 1, 'x')).toEqual([]);
    record(harness, taskId, { checks: 'failing' });
    expect(failReads(harness, taskId, PULL_REQUEST_READ_FAILURE_LIMIT, 'x').length).toBeGreaterThan(0);
    expect(harness.task(taskId).pullRequestReadFailures).toBe(PULL_REQUEST_READ_FAILURE_LIMIT);
    expect(failReads(harness, taskId, 3, 'x')).toEqual([]);
    expect(listOpenGates(harness.state, taskId).filter((gate) => gate.type === 'failure')).toEqual([]);
    pushFix(harness, taskId);
    record(harness, taskId);
    expect(harness.openGate(taskId).type).toBe('merge');
    failReads(harness, taskId, PULL_REQUEST_READ_FAILURE_LIMIT, 'x');
    expect(listOpenGates(harness.state, taskId).map((gate) => gate.type)).toEqual(['merge']);
    expect(harness.task(taskId).pullRequestWatch?.stopped).toBeNull();
    const other = createHarness();
    const planning = createTask(other);
    expect(other.send({ type: 'pull_request.read_failed', taskId: planning, detail: 'x' }).events).toEqual(
      []
    );
  });
});

describe('merge queues', () => {
  function merging() {
    const { harness, taskId } = shipping();
    record(harness, taskId);
    approve(harness, taskId);
    return { harness, taskId };
  }

  test('a pull request waiting in the merge queue is waiting, and its progress shows', () => {
    const { harness, taskId } = merging();
    record(harness, taskId, { mergeQueue: { state: 'queued', position: 3 } });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'awaiting_merge',
      stageReason: 'waiting in GitHub’s merge queue (position 3)',
    });
    record(harness, taskId, { mergeQueue: { state: 'awaiting_checks', position: null } });
    expect(harness.task(taskId).stageReason).toBe('in GitHub’s merge queue, waiting for its checks');
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    record(harness, taskId, { state: 'merged' });
    expect(harness.task(taskId).stage).toBe('merged');
  });

  test('a queue that takes the pull request out reopens the merge gate with its reason', () => {
    const { harness, taskId } = merging();
    record(harness, taskId, { mergeQueue: { state: 'queued', position: 1 } });
    record(harness, taskId, { mergeQueue: null, queueRemoval: 'failed checks' });
    const gate = harness.openGate(taskId);
    expect(gate.type).toBe('merge');
    expect(
      gate.body.startsWith(
        'GitHub’s merge queue took the pull request out without merging it: failed checks.'
      )
    ).toBe(true);
    expect(harness.task(taskId).stageReason).toBe('removed from the merge queue');
  });

  test('a queue that takes out a pull request that now fails sends it to the agent with the reason', () => {
    const { harness, taskId } = merging();
    record(harness, taskId, { mergeQueue: { state: 'auto_merge', position: null } });
    expect(harness.task(taskId).stageReason).toBe('waiting for GitHub to merge it automatically');
    record(harness, taskId, { mergeQueue: null, checks: 'failing' });
    expect(harness.activeRun(taskId).prompt).toContain(
      'GitHub turned off automatic merging before it merged the pull request.'
    );
  });

  test('a queue removal without a reason still says what happened', () => {
    const { harness, taskId } = merging();
    record(harness, taskId, { mergeQueue: { state: 'locked', position: 1 } });
    record(harness, taskId, { mergeQueue: null });
    expect(
      harness
        .openGate(taskId)
        .body.startsWith('GitHub’s merge queue took the pull request out without merging it.')
    ).toBe(true);
  });
});

describe('cancelling effects', () => {
  test('a finished task cancels what is still queued for it; a cancel also stops a merge', () => {
    const { harness, taskId } = shipping();
    record(harness, taskId);
    approve(harness, taskId);
    const merged = record(harness, taskId, { state: 'merged' });
    expect(merged.cancellations).toEqual([
      {
        taskId,
        kinds: [
          'task.triage',
          'config.verify',
          'worktree.create',
          'checks.run',
          'pull_request.open',
          'pull_request.push',
          'pull_request.watch',
        ],
        reason: 'The task is finished.',
      },
    ]);
    const other = shipping();
    const cancelled = other.harness.send({ type: 'task.cancel', taskId: other.taskId });
    expect(cancelled.cancellations[0]?.kinds).toContain('pull_request.merge');
  });

  test('a new round of checks cancels the round it replaces', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    expect(harness.task(taskId).stage).toBe('checking');
    const retried = harness.send({ type: 'task.retry', taskId });
    expect(retried.cancellations).toEqual([
      { taskId, kinds: ['checks.run'], reason: 'A new round of checks replaced it.' },
    ]);
  });
});

function approved() {
  const harness = createHarness();
  const taskId = createTask(harness);
  reachReviewGate(harness, taskId);
  approve(harness, taskId);
  return { harness, taskId };
}

const HOOK_OUTPUT = 'bun test v1.3\nFAIL test/a.test.ts > adds\nerror: script "test" exited with code 1';

function failHook(harness: Harness, taskId: string, failures: string[] | null = ['test/a.test.ts › adds']) {
  return harness.send({ type: 'pull_request.record_hook_failure', taskId, output: HOOK_OUTPUT, failures });
}

function finishFix(harness: Harness, taskId: string) {
  harness.send({
    type: 'agent.complete_fix',
    runId: harness.activeRun(taskId).id,
    summary: 'Fixed it.',
    checks: ['c1'],
  });
  harness.send({ type: 'checks.record', taskId, results: [checkResult('c1', 'pass')] });
}

describe('getting the branch to GitHub', () => {
  test('each step of the push shows on the task: updating onto the base, the hook, opening', () => {
    const { harness, taskId } = approved();
    harness.send({ type: 'pull_request.record_step', taskId, step: { kind: 'updating', base: 'main' } });
    expect(harness.task(taskId).stageReason).toBe('updating the branch onto main');
    harness.send({ type: 'pull_request.record_step', taskId, step: { kind: 'pushing', hook: true } });
    expect(harness.task(taskId).stageReason).toBe(
      'pushing the branch (the repository’s pre-push hook is running)'
    );
    harness.send({ type: 'pull_request.record_step', taskId, step: { kind: 'pushing', hook: false } });
    expect(harness.task(taskId).stageReason).toBe('pushing the branch');
    pushed(harness, taskId, 'abc');
    harness.send({ type: 'pull_request.record_step', taskId, step: { kind: 'opening' } });
    expect(harness.task(taskId).stageReason).toBe('opening the pull request');
  });

  test('pushing to an open pull request says it pushes the changes, and a late step changes nothing', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'pending' }) });
    const late = { type: 'pull_request.record_step', taskId, step: { kind: 'opening' } } as const;
    expect(harness.send(late).events).toEqual([]);
    expect(harness.task(taskId).stageReason).toBe('waiting for CI');

    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'failing' }) });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Fixed CI.' });
    harness.send({ type: 'pull_request.record_step', taskId, step: { kind: 'pushing', hook: true } });
    expect(harness.task(taskId).stageReason).toBe(
      'pushing the changes (the repository’s pre-push hook is running)'
    );
  });

  test('a retry names the step, when it runs, the attempt and the error, and logs one entry', () => {
    const { harness, taskId } = approved();
    harness.send({
      type: 'pull_request.record_retry',
      taskId,
      step: 'pushing',
      attempt: 1,
      attempts: 5,
      retryAt: harness.now + 1 + 30_000,
      detail: 'Could not resolve host: github.com',
    });
    const task = harness.task(taskId);
    expect(task.stageReason).toBe('pushing again in 30s, attempt 2 of 5: Could not resolve host: github.com');
    expect(task.activity.at(-1)).toMatchObject({
      kind: 'pull_request',
      text: 'Pushing failed on attempt 1 of 5, trying again in 30s',
      detail: 'Could not resolve host: github.com',
    });

    harness.send({
      type: 'pull_request.record_retry',
      taskId,
      step: 'opening',
      attempt: 2,
      attempts: 5,
      retryAt: harness.now + 1,
      detail: 'HTTP 502',
    });
    expect(harness.task(taskId).stageReason).toBe(
      'opening the pull request again in 1s, attempt 3 of 5: HTTP 502'
    );
    expect(harness.task(taskId).activity.at(-1)?.text).toBe(
      'Opening the pull request failed on attempt 2 of 5, trying again in 1s'
    );
  });

  test('a step, a retry or a hook failure for a task that is not pushing is ignored', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const commands: ShinsaCommand[] = [
      { type: 'pull_request.record_step', taskId, step: { kind: 'opening' } },
      {
        type: 'pull_request.record_retry',
        taskId,
        step: 'updating',
        attempt: 1,
        attempts: 5,
        retryAt: 0,
        detail: 'x',
      },
      { type: 'pull_request.record_update_conflict', taskId, base: 'main', files: ['a.ts'] },
      { type: 'pull_request.record_hook_failure', taskId, output: 'x', failures: null },
    ];
    for (const command of commands) expect(harness.send(command).events).toEqual([]);
  });
});

describe('conflicts while updating onto the base', () => {
  test('go to the agent as a fix round, then the touched checks run and Shinsa pushes again', () => {
    const { harness, taskId } = approved();
    harness.send({
      type: 'pull_request.record_update_conflict',
      taskId,
      base: 'main',
      files: ['src/b.ts', 'src/a.ts'],
    });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'fixing',
      stageReason: 'resolving conflicts with main',
      fixFor: 'update',
    });
    const prompt = harness.activeRun(taskId).prompt ?? '';
    expect(prompt).toContain(
      'The branch was being updated onto `main` before Shinsa pushed it, and these files conflict:\n- src/a.ts\n- src/b.ts'
    );
    expect(prompt).toContain('merge it in with `git merge origin/main`');
    const opened = harness.effectsOf('pull_request.open').length;

    harness.send({
      type: 'agent.complete_fix',
      runId: harness.activeRun(taskId).id,
      summary: 'Resolved.',
      checks: ['c1'],
    });
    expect(harness.task(taskId).stage).toBe('checking');
    harness.send({ type: 'checks.record', taskId, results: [checkResult('c1', 'pass')] });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'shipping',
      stageReason: 'opening the pull request',
    });
    expect(harness.effectsOf('pull_request.open')).toHaveLength(opened + 1);
  });

  test('a failing check after the resolution is fixed, and the push still follows', () => {
    const { harness, taskId } = approved();
    harness.send({ type: 'pull_request.record_update_conflict', taskId, base: 'main', files: ['a.ts'] });
    harness.send({
      type: 'agent.complete_fix',
      runId: harness.activeRun(taskId).id,
      summary: 'Resolved.',
      checks: ['c1'],
    });
    harness.send({ type: 'checks.record', taskId, results: [checkResult('c1', 'fail', 'boom')] });
    expect(harness.task(taskId).fixFor).toBe('checks');
    finishFix(harness, taskId);
    expect(harness.task(taskId)).toMatchObject({ stage: 'shipping', pushPending: true });
  });
});

describe('a pre-push hook that rejects the push', () => {
  test('goes to the agent with the output and the failures it names, never to a retry', () => {
    const { harness, taskId } = approved();
    failHook(harness, taskId);
    const task = harness.task(taskId);
    expect(task).toMatchObject({
      stage: 'fixing',
      stageReason: 'fixing what the pre-push hook found',
      fixFor: 'hook',
    });
    expect(task.pushHookFailure?.signature).toBe('test/a.test.ts › adds');
    expect(task.activity.find((entry) => entry.text === 'The pre-push hook rejected the push')?.detail).toBe(
      'test/a.test.ts › adds'
    );
    const prompt = harness.activeRun(taskId).prompt ?? '';
    expect(prompt).toContain("The repository's pre-push hook rejected the push");
    expect(prompt).toContain('- test/a.test.ts › adds');
    expect(prompt).toContain(`\`\`\`\n${HOOK_OUTPUT}\n\`\`\``);
    expect(prompt).toContain('never the whole suite the hook runs');

    finishFix(harness, taskId);
    expect(harness.task(taskId)).toMatchObject({
      stage: 'shipping',
      stageReason: 'opening the pull request',
    });
  });

  test('the same failure after a fix round opens a gate with the output; sending it again starts a round', () => {
    const { harness, taskId } = approved();
    failHook(harness, taskId);
    finishFix(harness, taskId);
    failHook(harness, taskId);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({
      type: 'failure',
      cause: 'push_hook',
      title: 'The pre-push hook failed again',
    });
    expect(gate.body).toContain('- test/a.test.ts › adds');
    expect(gate.body).toContain(`\`\`\`\n${HOOK_OUTPUT}\n\`\`\``);
    expect(gate.body).toContain('Shinsa never pushes without the hook.');
    expect(harness.task(taskId).stageReason).toBe('the pre-push hook failed again');
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    expect(
      harness.send({ type: 'pull_request.record_step', taskId, step: { kind: 'opening' } }).events
    ).toEqual([]);

    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null });
    expect(harness.task(taskId)).toMatchObject({ stage: 'fixing', fixFor: 'hook', fixRounds: 1 });
    expect(harness.activeRun(taskId).prompt).toContain(HOOK_OUTPUT);

    finishFix(harness, taskId);
    failHook(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'reply',
      response: 'Skip the flaky snapshot test',
    });
    expect(harness.activeRun(taskId).prompt).toContain(
      'Guidance from the human: Skip the flaky snapshot test'
    );
  });

  test('a different failure starts another round; output it cannot read counts as the same failure', () => {
    const { harness, taskId } = approved();
    failHook(harness, taskId);
    finishFix(harness, taskId);
    failHook(harness, taskId, ['test/b.test.ts › subtracts']);
    expect(harness.task(taskId).stage).toBe('fixing');
    finishFix(harness, taskId);
    failHook(harness, taskId, null);
    expect(harness.task(taskId).stage).toBe('fixing');
    expect(harness.activeRun(taskId).prompt).not.toContain('The failures it names');
    finishFix(harness, taskId);
    failHook(harness, taskId, []);
    expect(harness.openGate(taskId).cause).toBe('push_hook');
  });

  test('cancelling at the gate cancels the task; a push that gets through forgets the failure', () => {
    const { harness, taskId } = approved();
    failHook(harness, taskId);
    finishFix(harness, taskId);
    pushed(harness, taskId);
    expect(harness.task(taskId).pushHookFailure).toBeNull();

    const other = approved();
    failHook(other.harness, other.taskId);
    finishFix(other.harness, other.taskId);
    failHook(other.harness, other.taskId);
    other.harness.send({
      type: 'gate.answer',
      gateId: other.harness.openGate(other.taskId).id,
      decision: 'reject',
      response: null,
    });
    expect(other.harness.task(other.taskId).stage).toBe('cancelled');
  });
});

function readHead(harness: Harness, taskId: string, overrides: Partial<PullRequest>, ci?: RepoCi) {
  return harness.send({
    type: 'pull_request.record',
    taskId,
    pullRequest: pullRequest(overrides),
    ...(ci ? { ci } : {}),
  });
}

function hasMergeGate(harness: Harness, taskId: string) {
  return listOpenGates(harness.state, taskId).some((gate) => gate.type === 'merge');
}

function listEventTypes(harness: Harness, taskId: string, from: number) {
  return harness.events
    .filter((event) => event.seq > from && 'taskId' in event && event.taskId === taskId)
    .map((event) => event.type);
}

describe('no checks on a new head', () => {
  test('wait for CI until the grace window after the push has passed, then reach the merge gate', () => {
    const { harness, taskId } = shipping();
    pushed(harness, taskId, 'head');
    readHead(harness, taskId, { checks: 'none', mergeable: null, headSha: 'head' }, 'workflows');
    expect(harness.task(taskId).stageReason).toBe('waiting for CI');
    harness.advance(CI_GRACE_MS - 10);
    readHead(harness, taskId, { checks: 'none', headSha: 'head' }, 'workflows');
    expect(harness.task(taskId)).toMatchObject({ stage: 'shipping', stageReason: 'waiting for CI' });
    expect(hasMergeGate(harness, taskId)).toBe(false);
    harness.advance(10);
    readHead(harness, taskId, { checks: 'none', headSha: 'head' }, 'workflows');
    expect(harness.openGate(taskId)).toMatchObject({ type: 'merge', commit: 'head' });
    expect(harness.task(taskId).pullRequestWatch?.ciAbsent).toBe(true);
  });

  test('a read that does not say whether the repository has CI waits the same window', () => {
    const { harness, taskId } = shipping();
    readHead(harness, taskId, { checks: 'none' });
    expect(hasMergeGate(harness, taskId)).toBe(false);
    harness.advance(CI_GRACE_MS);
    readHead(harness, taskId, { checks: 'none' });
    expect(harness.openGate(taskId).type).toBe('merge');
  });

  test('the window starts at the push of the head GitHub shows, not at an earlier one', () => {
    const { harness, taskId } = shipping();
    readHead(harness, taskId, { checks: 'failing' }, 'workflows');
    harness.advance(CI_GRACE_MS * 2);
    pushFix(harness, taskId);
    const head = harness.task(taskId).pushedSha;
    readHead(harness, taskId, { checks: 'none', headSha: head }, 'workflows');
    expect(harness.task(taskId).stageReason).toBe('waiting for CI');
    expect(hasMergeGate(harness, taskId)).toBe(false);
  });

  test('checks that appear within the window are waited on, and the merge gate opens once they pass', () => {
    const { harness, taskId } = shipping();
    const before = harness.state.seq;
    pushed(harness, taskId, 'head');
    readHead(harness, taskId, { checks: 'none', mergeable: null, headSha: 'head' }, 'workflows');
    readHead(harness, taskId, { checks: 'none', mergeable: true, headSha: 'head' }, 'workflows');
    readHead(harness, taskId, { checks: 'pending', headSha: 'head' }, 'workflows');
    harness.advance(CI_GRACE_MS);
    readHead(harness, taskId, { checks: 'pending', headSha: 'head' }, 'workflows');
    expect(hasMergeGate(harness, taskId)).toBe(false);
    expect(listEventTypes(harness, taskId, before)).not.toContain('gate.withdrawn');
    readHead(harness, taskId, { checks: 'passing', headSha: 'head' }, 'workflows');
    expect(harness.openGate(taskId)).toMatchObject({ type: 'merge', commit: 'head' });
  });

  test('a repository whose base branch requires checks never counts no checks as clean', () => {
    const { harness, taskId } = shipping();
    readHead(harness, taskId, { checks: 'none' }, 'required');
    harness.advance(CI_GRACE_MS * 10);
    readHead(harness, taskId, { checks: 'none' }, 'required');
    expect(harness.task(taskId).stageReason).toBe('waiting for CI');
    expect(hasMergeGate(harness, taskId)).toBe(false);
  });

  test('the pull request #6 sequence: open, clean without checks, then CI registers, never opens and withdraws the gate', () => {
    const { harness, taskId } = shipping();
    const before = harness.state.seq;
    const since = harness.now;
    pushed(harness, taskId, '79ac117');
    readHead(
      harness,
      taskId,
      { number: 6, checks: 'none', mergeable: null, headSha: '79ac117' },
      'workflows'
    );
    harness.advance(2_000);
    readHead(
      harness,
      taskId,
      { number: 6, checks: 'none', mergeable: true, headSha: '79ac117' },
      'workflows'
    );
    harness.advance(14_000);
    readHead(
      harness,
      taskId,
      { number: 6, checks: 'pending', mergeable: true, headSha: '79ac117' },
      'workflows'
    );
    expect(harness.task(taskId)).toMatchObject({ stage: 'shipping', stageReason: 'waiting for CI' });
    expect(listEventTypes(harness, taskId, before)).not.toContain('gate.opened');
    readHead(
      harness,
      taskId,
      { number: 6, checks: 'passing', mergeable: true, headSha: '79ac117' },
      'workflows'
    );
    expect(harness.openGate(taskId).type).toBe('merge');
    const entries = harness.task(taskId).activity.filter((entry) => entry.at > since);
    expect(entries.map((entry) => entry.text)).toEqual(['Opened pull request #6', 'Ready to merge']);
  });
});

describe('the merge gate on one head', () => {
  test('checks that appear on the same head, or GitHub recomputing, leave the gate open', () => {
    const { harness, taskId } = shipping();
    pushed(harness, taskId, 'head');
    readHead(harness, taskId, { checks: 'none', headSha: 'head' }, 'none');
    const gate = harness.openGate(taskId);
    const before = harness.state.seq;
    readHead(harness, taskId, { checks: 'pending', headSha: 'head' }, 'none');
    readHead(harness, taskId, { checks: 'pending', mergeable: null, headSha: 'head' }, 'none');
    expect(harness.openGate(taskId).id).toBe(gate.id);
    expect(harness.task(taskId)).toMatchObject({
      stage: 'awaiting_merge',
      stageReason: 'pull request is clean',
    });
    expect(listEventTypes(harness, taskId, before)).not.toContain('task.staged');
  });

  test('a failing check on the same head takes the gate back and goes to the agent', () => {
    const { harness, taskId } = shipping();
    pushed(harness, taskId, 'head');
    readHead(harness, taskId, { checks: 'none', headSha: 'head' }, 'none');
    readHead(harness, taskId, { checks: 'failing', headSha: 'head' }, 'none');
    expect(hasMergeGate(harness, taskId)).toBe(false);
    expect(harness.task(taskId).stage).toBe('fixing');
  });

  test('a new comment on the same head takes the gate back', () => {
    const { harness, taskId } = shipping();
    pushed(harness, taskId, 'head');
    readHead(harness, taskId, { checks: 'none', headSha: 'head' }, 'none');
    harness.send({
      type: 'pull_request.record',
      taskId,
      pullRequest: pullRequest({ checks: 'pending', headSha: 'head' }),
      ci: 'none',
      remarks: [
        {
          id: 'c1',
          author: 'reviewer',
          createdAt: '2026-01-02T00:00:00Z',
          editedAt: null,
          body: 'Rename this.',
          path: null,
          url: null,
          reviewState: null,
        },
      ],
      viewer: 'me',
    });
    expect(hasMergeGate(harness, taskId)).toBe(false);
    expect(harness.task(taskId).stage).toBe('fixing');
  });

  test('a gate opened without a known head is kept for reads without one', () => {
    const { harness, taskId } = shipping();
    readHead(harness, taskId, {});
    const gate = harness.openGate(taskId);
    expect(gate.commit).toBeNull();
    readHead(harness, taskId, { checks: 'pending' });
    expect(harness.openGate(taskId).id).toBe(gate.id);
  });
});

describe('merging the head you approved', () => {
  test('approving the merge asks GitHub to merge the head the gate was opened for', () => {
    const { harness, taskId } = shipping();
    pushed(harness, taskId, 'head');
    readHead(harness, taskId, { headSha: 'head' });
    approve(harness, taskId);
    expect(harness.lastEffect('pull_request.merge')).toMatchObject({ taskId, headSha: 'head' });
  });

  test('a head that moves while the merge runs stops it and is judged like any new head', () => {
    const { harness, taskId } = shipping();
    pushed(harness, taskId, 'head');
    readHead(harness, taskId, { headSha: 'head' });
    approve(harness, taskId);
    readHead(harness, taskId, { checks: 'pending', headSha: 'theirs' }, 'workflows');
    expect(harness.task(taskId)).toMatchObject({
      stage: 'shipping',
      stageReason: 'waiting for CI',
      pushedSha: 'theirs',
    });
    const texts = harness.task(taskId).activity.map((entry) => entry.text);
    expect(texts).toContain('The branch changed before the merge');
    expect(texts).toContain('The branch moved to theirs, a commit Shinsa did not push');
    readHead(harness, taskId, { headSha: 'theirs' });
    expect(harness.openGate(taskId)).toMatchObject({ type: 'merge', commit: 'theirs' });
  });

  test('a queued merge whose head GitHub reports differently stays in the queue', () => {
    const { harness, taskId } = shipping();
    pushed(harness, taskId, 'head');
    readHead(harness, taskId, { headSha: 'head' });
    approve(harness, taskId);
    readHead(harness, taskId, { headSha: 'merge-group', mergeQueue: { state: 'queued', position: 1 } });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'awaiting_merge',
      stageReason: 'waiting in GitHub’s merge queue (position 1)',
    });
  });
});

describe('the activity while shipping', () => {
  test('going back from the merge gate to an open pull request says why, not that it opens it again', () => {
    const { harness, taskId } = shipping();
    readHead(harness, taskId, {});
    harness.send({ type: 'task.retry', taskId });
    const texts = harness
      .task(taskId)
      .activity.filter((entry) => entry.kind === 'stage')
      .map((entry) => entry.text);
    expect(texts.filter((text) => text === 'Opening the pull request')).toHaveLength(1);
    expect(texts.at(-1)).toBe('Checking the pull request');
  });
});

describe('evidence uploads', () => {
  function attach(harness: Harness, taskId: string) {
    harness.send({
      type: 'agent.attach_evidence',
      runId: harness.activeRun(taskId).id,
      kind: 'screenshot',
      title: 'Settings',
      uri: '/api/evidence/settings.png',
    });
    return Object.values(harness.state.evidence).find((piece) => piece.taskId === taskId)?.id ?? '';
  }

  test('keeps the GitHub address of each uploaded file on its evidence, through a replay', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const evidenceId = attach(harness, taskId);
    const url = 'https://github.com/user-attachments/assets/1';
    harness.send({ type: 'evidence.record_uploads', taskId, uploads: [{ evidenceId, url }] });
    expect(harness.state.evidence[evidenceId]?.uploadUrl).toBe(url);
    expect(replayEventLog(harness.events).state.evidence[evidenceId]?.uploadUrl).toBe(url);
  });

  test('records nothing for a known address, an unknown piece or another task’s piece', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const otherId = createTask(harness);
    proposePlan(harness, taskId);
    const evidenceId = attach(harness, taskId);
    const url = 'https://github.com/user-attachments/assets/1';
    harness.send({ type: 'evidence.record_uploads', taskId, uploads: [{ evidenceId, url }] });
    const uploads = [
      { evidenceId, url },
      { evidenceId: 'missing', url },
    ];
    expect(harness.send({ type: 'evidence.record_uploads', taskId, uploads }).events).toEqual([]);
    expect(
      harness.send({ type: 'evidence.record_uploads', taskId: otherId, uploads: [{ evidenceId, url: 'x' }] })
        .events
    ).toEqual([]);
  });
});
