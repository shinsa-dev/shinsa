import { describe, expect, test } from 'bun:test';
import { DomainError, type Run, type TeammateFork } from '../../src/index.ts';
import {
  approve,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  linkSession,
  PASSING,
  proposePlan,
  pullRequest,
  pushed,
  reachReviewGate,
  readyWorktree,
  shipAndMerge,
} from '../harness.ts';

const FORK_REQUEST = 'Safari users cannot open the tab group menu';

function forkTask(harness: Harness, forkOf: string, request = FORK_REQUEST) {
  const before = new Set(Object.keys(harness.state.tasks));
  harness.send({ type: 'task.create', request, repoId: harness.task(forkOf).repoId, forkOf });
  const taskId = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: request,
    repoId: harness.task(forkOf).repoId,
    size: 'small',
    branch: `fix/${taskId}`,
    waitsOn: [],
  });
  readyWorktree(harness, taskId);
  return taskId;
}

function mergedSource(harness: Harness, sessionId = 'source-session', provider = 'claude') {
  const taskId = createTask(harness);
  harness.send({ type: 'run.link', runId: harness.activeRun(taskId).id, sessionId, provider });
  shipAndMerge(harness, taskId);
  return taskId;
}

function promptOf(run: Run) {
  return run.prompt ?? '';
}

describe('forking a task', () => {
  test('the forked task’s first Agent run forks the source task’s session instead of resuming it', () => {
    const harness = createHarness();
    const sourceId = mergedSource(harness);
    const forkId = forkTask(harness, sourceId);
    const run = harness.activeRun(forkId);
    expect(harness.task(forkId).forkOf).toBe(sourceId);
    expect(run).toMatchObject({
      role: 'agent',
      purpose: 'plan',
      resume: false,
      sessionId: null,
      fork: { taskId: sourceId, sessionId: 'source-session' },
    });
    expect(harness.state.runs[run.fork?.runId ?? '']).toMatchObject({ taskId: sourceId, role: 'agent' });
    expect(promptOf(run)).toContain('Everything above this message was the work of the task');
    expect(promptOf(run)).toContain('never change its branch, its worktree or its pull request');
    expect(promptOf(run)).not.toContain('You do not have its conversation');
  });

  test('a fork of a merged task is told the change is on the default branch, with no worktree to read', () => {
    const harness = createHarness();
    const sourceId = mergedSource(harness);
    const source = harness.task(sourceId);
    const run = harness.activeRun(forkTask(harness, sourceId));
    expect(promptOf(run)).toContain(
      `Its change merged in pull request #${source.pullRequest?.number}, so the default branch this task starts from has it.`
    );
    expect(promptOf(run)).not.toContain('Read its code in its worktree');
  });

  test('a fork of a task still in review copies its session and points at its unmerged branch and worktree', () => {
    const harness = createHarness();
    const sourceId = createTask(harness);
    harness.send({
      type: 'run.link',
      runId: harness.activeRun(sourceId).id,
      sessionId: 'open-session',
      provider: 'claude',
    });
    reachReviewGate(harness, sourceId);
    const source = harness.task(sourceId);
    expect(source.stage).toBe('awaiting_review');
    const run = harness.activeRun(forkTask(harness, sourceId));
    expect(run.fork).toMatchObject({ taskId: sourceId, sessionId: 'open-session' });
    expect(promptOf(run)).toContain(
      `Its change is not merged yet: it is on branch ${source.branch}, not on the default branch this task starts from, so this worktree does not have it.`
    );
    expect(promptOf(run)).toContain(`Read its code in its worktree, \`${source.worktreePath}\``);
  });

  test('a fork of a task whose pull request is open names the branch and the pull request', () => {
    const harness = createHarness();
    const sourceId = createTask(harness);
    reachReviewGate(harness, sourceId);
    approve(harness, sourceId);
    pushed(harness, sourceId);
    harness.send({ type: 'pull_request.record', taskId: sourceId, pullRequest: pullRequest({ number: 77 }) });
    const source = harness.task(sourceId);
    expect(source.pullRequest?.state).toBe('open');
    expect(promptOf(harness.activeRun(forkTask(harness, sourceId)))).toContain(
      `it is on branch ${source.branch} in pull request #77, not on the default branch this task starts from`
    );
  });

  test('a fork of a fork copies the middle task’s own session, never the first one’s', () => {
    const harness = createHarness();
    const firstId = mergedSource(harness, 'first-session');
    const middleId = forkTask(harness, firstId);
    linkSession(harness, middleId, 'middle-session');
    const lastId = forkTask(harness, middleId, 'Firefox users cannot open it either');
    expect(harness.activeRun(lastId).fork).toMatchObject({ taskId: middleId, sessionId: 'middle-session' });
    expect(harness.task(lastId).forkOf).toBe(middleId);
    expect(promptOf(harness.activeRun(lastId))).toContain(`task ${harness.task(middleId).handle}`);
  });

  test('once the fork has a session of its own, every later run resumes that one', () => {
    const harness = createHarness();
    const sourceId = mergedSource(harness);
    const forkId = forkTask(harness, sourceId);
    linkSession(harness, forkId, 'forked-session');
    proposePlan(harness, forkId);
    const build = harness.activeRun(forkId);
    expect(build).toMatchObject({ resume: true, sessionId: 'forked-session' });
    expect(build.fork).toBeUndefined();
    expect(promptOf(build)).not.toContain('Everything above this message');
    expect(harness.state.runs[Object.keys(harness.state.runs)[0] ?? '']?.sessionId).toBe('source-session');
  });

  test('a fork that never got a session forks again on its retry', () => {
    const harness = createHarness();
    const sourceId = mergedSource(harness);
    const forkId = forkTask(harness, sourceId);
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(forkId).id,
      outcome: 'failed',
      summary: 'The provider is overloaded.',
      failure: { class: 'overloaded', message: 'overloaded', code: null, retryable: true, resetAt: null },
    });
    harness.send({ type: 'task.retry', taskId: forkId });
    expect(harness.activeRun(forkId).fork).toMatchObject({ sessionId: 'source-session' });
  });

  test('a fork whose own session ran out of context starts fresh with the source’s brief, never forks again', () => {
    const harness = createHarness();
    const sourceId = mergedSource(harness);
    const forkId = forkTask(harness, sourceId);
    linkSession(harness, forkId, 'forked-session');
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(forkId).id,
      outcome: 'failed',
      summary: 'The context is full.',
      failure: {
        class: 'context_window_full',
        message: 'prompt is too long',
        code: null,
        retryable: false,
        resetAt: null,
      },
    });
    const fresh = harness.activeRun(forkId);
    expect(fresh).toMatchObject({ resume: false, sessionId: null });
    expect(fresh.fork).toBeUndefined();
    expect(promptOf(fresh)).toContain('You do not have its conversation');
  });

  test('without a session to fork, the first run is told what the source task asked and did', () => {
    const harness = createHarness();
    const sourceId = createTask(harness, { request: 'Add tab groups' });
    proposePlan(harness, sourceId);
    completePhase(harness, sourceId, 'Added the groups.');
    const forkId = forkTask(harness, sourceId);
    const run = harness.activeRun(forkId);
    expect(run.fork).toBeUndefined();
    expect(run.resume).toBe(false);
    expect(promptOf(run)).toContain('This task carries on from the task');
    expect(promptOf(run)).toContain('Its request:\nAdd tab groups');
    expect(promptOf(run)).toContain('- Round 1: Add tab groups (in progress)');
    expect(promptOf(run)).toContain(
      `Its change is not merged yet: it is on branch ${harness.task(sourceId).branch}, not on the default branch this task starts from, so this worktree does not have it.`
    );
    expect(promptOf(run)).toContain(
      `Read its code in its worktree, \`${harness.task(sourceId).worktreePath}\`, when you need it, but never change anything there.`
    );
    expect(promptOf(run)).toContain(
      `Read the task itself with \`read_task\` (id ${sourceId}) when you need more.`
    );
  });

  test('a source session on another provider, or one the provider lost, is described instead of forked', () => {
    const harness = createHarness();
    const codexId = mergedSource(harness, 'codex-thread', 'codex');
    expect(harness.activeRun(forkTask(harness, codexId)).fork).toBeUndefined();

    const lostId = mergedSource(harness, 'lost-session');
    const lostRun = Object.values(harness.state.runs).find((run) => run.sessionId === 'lost-session');
    harness.send({ type: 'run.record_lost_session', runId: lostRun?.id ?? '', sessionId: 'lost-session' });
    const forkId = forkTask(harness, lostId);
    expect(harness.activeRun(forkId).fork).toBeUndefined();
    expect(promptOf(harness.activeRun(forkId))).toContain('You do not have its conversation');
  });

  test('the reviewer of a fork never forks and is not told about the source', () => {
    const harness = createHarness();
    const sourceId = mergedSource(harness);
    const forkId = forkTask(harness, sourceId);
    linkSession(harness, forkId, 'forked-session');
    proposePlan(harness, forkId);
    completePhase(harness, forkId);
    completePhase(harness, forkId);
    harness.send({ type: 'checks.record', taskId: forkId, results: PASSING });
    const reviewer = harness.activeRun(forkId);
    expect(reviewer.role).toBe('reviewer');
    expect(reviewer.fork).toBeUndefined();
    expect(promptOf(reviewer)).not.toContain('carries on from the task');
  });

  test('both tasks record the fork in their activity', () => {
    const harness = createHarness();
    const sourceId = mergedSource(harness);
    const forkId = forkTask(harness, sourceId);
    const source = harness.task(sourceId);
    const fork = harness.task(forkId);
    expect(fork.activity.find((entry) => entry.kind === 'fork')).toMatchObject({
      actor: 'you',
      text: `Forked from ${source.handle} “${source.title}”`,
    });
    expect(source.activity.find((entry) => entry.kind === 'fork')).toMatchObject({
      actor: 'you',
      text: `Forked into ${fork.handle} “${FORK_REQUEST}”`,
      detail: FORK_REQUEST,
    });
  });

  test('a fork of an unknown task is refused before anything is created', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const before = Object.keys(harness.state.tasks).length;
    expect(() =>
      harness.send({
        type: 'task.create',
        request: 'Fix it',
        repoId: harness.task(taskId).repoId,
        forkOf: 'nope',
      })
    ).toThrow(DomainError);
    expect(Object.keys(harness.state.tasks)).toHaveLength(before);
  });

  test('an agent forks its own task with create_task, and the task records it once', () => {
    const harness = createHarness();
    const sourceId = createTask(harness);
    linkSession(harness, sourceId, 'source-session');
    proposePlan(harness, sourceId);
    const builder = harness.activeRun(sourceId);
    const before = new Set(Object.keys(harness.state.tasks));
    harness.send({
      type: 'agent.create_task',
      runId: builder.id,
      requestKey: 'fork-1',
      request: FORK_REQUEST,
      repoId: null,
      thisWaits: false,
      forkOf: sourceId,
    });
    const fork = Object.values(harness.state.tasks).find((task) => !before.has(task.id));
    expect(fork).toMatchObject({ forkOf: sourceId, createdBy: { kind: 'courier', taskId: sourceId } });
    expect(fork?.activity.find((entry) => entry.kind === 'fork')).toMatchObject({ actor: 'agent' });
    expect(harness.task(sourceId).activity.filter((entry) => entry.kind === 'fork')).toHaveLength(0);
  });

  test('an agent can fork another task, which records the fork', () => {
    const harness = createHarness();
    const otherId = mergedSource(harness);
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({
      type: 'agent.create_task',
      runId: harness.activeRun(taskId).id,
      requestKey: 'fork-2',
      request: FORK_REQUEST,
      repoId: null,
      thisWaits: false,
      forkOf: otherId,
    });
    expect(harness.task(otherId).activity.at(-1)).toMatchObject({ kind: 'fork', actor: 'agent' });
  });

  test('a task reaching review keeps its fork link', () => {
    const harness = createHarness();
    const sourceId = mergedSource(harness);
    const forkId = forkTask(harness, sourceId);
    reachReviewGate(harness, forkId);
    expect(harness.task(forkId).forkOf).toBe(sourceId);
  });
});

const TEAMMATE_FORK: TeammateFork = {
  instanceId: 'kai-macbook',
  taskId: 'kai-task',
  handle: 'PAY-1',
  title: 'Retry failed card payments',
  owner: 'Kai',
  request: 'Retry a failed card payment once before showing the error',
  rounds: ['- Round 1: Retry failed card payments (in review, pull request #12): Retries once'],
  branch: 'fix/payment-retry',
  pullRequest: { number: 12, url: 'https://github.com/acme/pay/pull/12', state: 'open' },
};

function forkTeammate(harness: Harness, fork: TeammateFork) {
  const source = createTask(harness);
  const before = new Set(Object.keys(harness.state.tasks));
  harness.send({
    type: 'task.create',
    request: FORK_REQUEST,
    repoId: harness.task(source).repoId,
    teammateFork: fork,
  });
  const taskId = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: FORK_REQUEST,
    repoId: harness.task(source).repoId,
    size: 'small',
    branch: `fix/${taskId}`,
    waitsOn: [],
  });
  readyWorktree(harness, taskId);
  return taskId;
}

describe('forking a teammate’s task', () => {
  test('starts a fresh session told what the teammate’s task was asked and did, and how to read its branch', () => {
    const harness = createHarness();
    const forkId = forkTeammate(harness, TEAMMATE_FORK);
    const run = harness.activeRun(forkId);
    expect(harness.task(forkId).teammateFork).toEqual(TEAMMATE_FORK);
    expect(run.fork ?? null).toBeNull();
    const prompt = promptOf(run);
    expect(prompt).toContain('This task carries on from Kai’s task PAY-1 “Retry failed card payments”');
    expect(prompt).toContain(TEAMMATE_FORK.request);
    expect(prompt).toContain(TEAMMATE_FORK.rounds[0] ?? '');
    expect(prompt).toContain('Run `git fetch origin fix/payment-retry`');
    expect(prompt).toContain('pull request #12 (https://github.com/acme/pay/pull/12)');
    expect(harness.task(forkId).activity.find((entry) => entry.kind === 'fork')).toMatchObject({
      actor: 'you',
      text: 'Forked from Kai’s task PAY-1',
    });
  });

  test('names a merged change, a missing branch and an unknown owner plainly', () => {
    const merged = createHarness();
    const mergedRun = merged.activeRun(
      forkTeammate(merged, {
        ...TEAMMATE_FORK,
        pullRequest: { number: 12, url: 'https://github.com/acme/pay/pull/12', state: 'merged' },
      })
    );
    expect(promptOf(mergedRun)).toContain('Its change merged in pull request #12');
    const bare = createHarness();
    const bareId = forkTeammate(bare, {
      ...TEAMMATE_FORK,
      owner: null,
      handle: null,
      branch: null,
      pullRequest: null,
    });
    expect(promptOf(bare.activeRun(bareId))).toContain(
      'This task carries on from a teammate’s task “Retry failed card payments”'
    );
    expect(promptOf(bare.activeRun(bareId))).toContain('Its change is not merged yet, so this worktree');
    expect(bare.task(bareId).activity.find((entry) => entry.kind === 'fork')?.text).toBe(
      'Forked from a teammate’s task “Retry failed card payments”'
    );
  });

  test('is refused together with a fork of a task of this machine', () => {
    const harness = createHarness();
    const sourceId = createTask(harness);
    expect(() =>
      harness.send({
        type: 'task.create',
        request: FORK_REQUEST,
        repoId: harness.task(sourceId).repoId,
        forkOf: sourceId,
        teammateFork: TEAMMATE_FORK,
      })
    ).toThrow(DomainError);
  });

  test('an agent forks a teammate’s task with create_task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const before = new Set(Object.keys(harness.state.tasks));
    harness.send({
      type: 'agent.create_task',
      runId: harness.activeRun(taskId).id,
      requestKey: 'teammate-fork',
      request: FORK_REQUEST,
      repoId: null,
      thisWaits: false,
      teammateFork: TEAMMATE_FORK,
    });
    const fork = Object.values(harness.state.tasks).find((task) => !before.has(task.id));
    expect(fork?.teammateFork).toEqual(TEAMMATE_FORK);
    expect(fork?.activity.find((entry) => entry.kind === 'fork')).toMatchObject({ actor: 'agent' });
  });
});
