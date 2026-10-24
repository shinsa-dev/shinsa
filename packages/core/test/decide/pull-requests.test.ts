import { describe, expect, test } from 'bun:test';
import { PULL_REQUEST_READ_FAILURE_LIMIT } from '../../src/decide/watch.ts';
import {
  listActiveRuns,
  listOpenGates,
  type PullRequest,
  type PullRequestRemark,
  replayEventLog,
} from '../../src/index.ts';
import {
  approve,
  buildAll,
  createHarness,
  createTask,
  type Harness,
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

  test('a pull request without CI reaches the merge gate', () => {
    const { harness, taskId } = shipping();
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'none' }) });
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

  test('a pull request that keeps failing the same way stops after two fix rounds', () => {
    const { harness, taskId } = shipping();
    for (let round = 0; round < 3; round += 1) {
      harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'failing' }) });
      if (harness.task(taskId).stage !== 'fixing') break;
      pushFix(harness, taskId);
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
  test('a new comment holds the merge gate and a fixer reads it; once read, the clean pull request reaches the merge gate', () => {
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

  test('the reader’s own replies never start a fixer', () => {
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

  test('a queue that takes out a pull request that now fails sends it to a fixer with the reason', () => {
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
