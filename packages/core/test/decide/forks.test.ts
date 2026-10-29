import { describe, expect, test } from 'bun:test';
import { DomainError, type Run } from '../../src/index.ts';
import {
  completePhase,
  createHarness,
  createTask,
  type Harness,
  linkSession,
  PASSING,
  proposePlan,
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
    expect(promptOf(run)).toContain('Read it with `read_task` when you need more.');
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
