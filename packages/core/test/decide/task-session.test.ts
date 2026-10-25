import { describe, expect, test } from 'bun:test';
import { listOpenGates, type Run } from '../../src/index.ts';
import {
  approve,
  buildAll,
  completePhase,
  createHarness,
  createTask,
  failing,
  type Harness,
  linkSession,
  PASSING,
  proposePlan,
  pullRequest,
  pushed,
} from '../harness.ts';

function readyRound(harness: Harness, taskId: string) {
  harness.send({ type: 'config.record', taskId, problems: [] });
  const task = harness.task(taskId);
  if (task.stage !== 'triage' || !task.branch) return;
  harness.send({ type: 'worktree.ready', taskId, path: `/wt/${taskId}`, branch: task.branch });
}

function newRound(
  harness: Harness,
  taskId: string,
  text: string,
  shape?: 'answer' | 'change' | 'investigate'
) {
  harness.send({ type: 'task.message', taskId, text, kind: 'new_round', ...(shape ? { shape } : {}) });
}

function reviewClean(harness: Harness, taskId: string) {
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  linkSession(harness, taskId, 'reviewer-1');
  harness.send({ type: 'agent.report_review', runId: harness.activeRun(taskId).id, findings: [] });
}

function shipAndMerge(harness: Harness, taskId: string, number = 42) {
  approve(harness, taskId);
  pushed(harness, taskId);
  harness.send({
    type: 'pull_request.record',
    taskId,
    pullRequest: pullRequest({ number, url: `https://github.com/o/r/pull/${number}` }),
  });
  approve(harness, taskId);
  harness.send({
    type: 'pull_request.record',
    taskId,
    pullRequest: pullRequest({ number, url: `https://github.com/o/r/pull/${number}`, state: 'merged' }),
  });
}

function answer(harness: Harness, taskId: string, body = 'It uses Redis.') {
  harness.send({ type: 'agent.deliver', runId: harness.activeRun(taskId).id, step: 'answer', body });
}

function expectResumes(run: Run, sessionId: string) {
  expect(run).toMatchObject({ resume: true, sessionId });
}

describe('one agent session per task', () => {
  test('planning, every phase, every fix and the next round after a merge resume one session', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    linkSession(harness, taskId, 'task-session');
    proposePlan(harness, taskId);
    expectResumes(harness.activeRun(taskId), 'task-session');
    completePhase(harness, taskId);
    expectResumes(harness.activeRun(taskId), 'task-session');
    completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing() });
    expect(harness.activeRun(taskId)).toMatchObject({
      purpose: 'fix',
      resume: true,
      sessionId: 'task-session',
    });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Fixed.' });
    reviewClean(harness, taskId);
    shipAndMerge(harness, taskId);
    newRound(harness, taskId, 'Now add a setting for it', 'change');
    readyRound(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({
      purpose: 'plan',
      resume: true,
      sessionId: 'task-session',
    });
  });

  test('an answer round after a change round resumes the Agent’s session, and the next change round resumes it again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    linkSession(harness, taskId, 'task-session');
    buildAll(harness, taskId);
    reviewClean(harness, taskId);
    shipAndMerge(harness, taskId);
    newRound(harness, taskId, 'How many ended up in Archive?', 'answer');
    readyRound(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({
      role: 'answerer',
      resume: true,
      sessionId: 'task-session',
    });
    answer(harness, taskId);
    newRound(harness, taskId, 'Move them back', 'change');
    readyRound(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({
      role: 'agent',
      purpose: 'plan',
      sessionId: 'task-session',
    });
  });

  test('the Agent of a later round resumes an earlier round’s inquiry when the task never had an Agent', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.reshape',
      runId: harness.activeRun(taskId).id,
      shape: 'answer',
      reason: 'A question.',
    });
    readyRound(harness, taskId);
    linkSession(harness, taskId, 'answer-session');
    answer(harness, taskId);
    newRound(harness, taskId, 'Then move it to Valkey', 'change');
    readyRound(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({
      role: 'agent',
      purpose: 'plan',
      resume: true,
      sessionId: 'answer-session',
    });
  });

  test('retrying a failed answer resumes its session instead of starting fresh', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.reshape',
      runId: harness.activeRun(taskId).id,
      shape: 'answer',
      reason: 'A question.',
    });
    readyRound(harness, taskId);
    linkSession(harness, taskId, 'answer-session');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      harness.send({
        type: 'run.end',
        runId: harness.activeRun(taskId).id,
        outcome: 'failed',
        summary: 'Overloaded',
      });
    }
    const gate = listOpenGates(harness.state, taskId)[0];
    expect(gate?.type).toBe('failure');
    harness.send({ type: 'task.retry', taskId });
    expect(harness.activeRun(taskId)).toMatchObject({
      role: 'answerer',
      resume: true,
      sessionId: 'answer-session',
    });
  });

  test('a session that ran out of context is never resumed again; the fresh one takes over', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    linkSession(harness, taskId, 'full-session');
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
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
    const fresh = harness.activeRun(taskId);
    expect(fresh).toMatchObject({ resume: false, sessionId: null });
    harness.send({ type: 'task.message', taskId, text: 'Also keep the old name', kind: 'feedback' });
    expect(harness.activeRun(taskId)).toMatchObject({ resume: false, sessionId: null });
    linkSession(harness, taskId, 'second-session');
    proposePlan(harness, taskId);
    expectResumes(harness.activeRun(taskId), 'second-session');
  });

  test('a run that failed before it had a session is retried on the task’s session once the providers agree', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { agentProviders: { answerer: 'codex' } } });
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.reshape',
      runId: harness.activeRun(taskId).id,
      shape: 'answer',
      reason: 'A question.',
    });
    readyRound(harness, taskId);
    linkSession(harness, taskId, 'answer-session');
    answer(harness, taskId);
    newRound(harness, taskId, 'Then move it to Valkey', 'change');
    readyRound(harness, taskId);
    const fresh = harness.activeRun(taskId);
    expect(fresh).toMatchObject({ role: 'agent', resume: false, sessionId: null });
    harness.send({
      type: 'settings.change',
      patch: { agentProviders: { answerer: 'codex', agent: 'codex' } },
    });
    harness.send({ type: 'run.end', runId: fresh.id, outcome: 'failed', summary: 'The process crashed.' });
    expect(harness.activeRun(taskId)).toMatchObject({
      role: 'agent',
      provider: 'codex',
      resume: true,
      sessionId: 'answer-session',
    });
  });

  test('another kind of work on the same provider resumes the session on its own model', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { agentModels: { answerer: 'sonnet' } } });
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.reshape',
      runId: harness.activeRun(taskId).id,
      shape: 'answer',
      reason: 'A question.',
    });
    readyRound(harness, taskId);
    expect(harness.activeRun(taskId).model).toBe('sonnet');
    linkSession(harness, taskId, 'answer-session');
    answer(harness, taskId);
    newRound(harness, taskId, 'Then move it to Valkey', 'change');
    readyRound(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({
      role: 'agent',
      model: 'opus',
      resume: true,
      sessionId: 'answer-session',
    });
  });
});

describe('one reviewer session per task', () => {
  test('the reviewer resumes its own session on the next review, never the Agent’s, and is told to judge afresh', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    linkSession(harness, taskId, 'task-session');
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const first = harness.activeRun(taskId);
    expect(first).toMatchObject({ role: 'reviewer', resume: false, sessionId: null });
    expect(first.prompt).not.toContain('You reviewed earlier work on this task');
    linkSession(harness, taskId, 'reviewer-session');
    harness.send({
      type: 'agent.report_review',
      runId: first.id,
      findings: [{ severity: 'blocking', message: 'Breaks the build.', file: 'src/a.ts', line: 1 }],
    });
    expect(harness.activeRun(taskId)).toMatchObject({
      role: 'agent',
      purpose: 'fix',
      sessionId: 'task-session',
    });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Fixed.' });
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const second = harness.activeRun(taskId);
    expect(second).toMatchObject({ role: 'reviewer', resume: true, sessionId: 'reviewer-session' });
    expect(second.prompt).toContain('You reviewed earlier work on this task in this conversation.');
  });
});
