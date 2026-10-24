import { describe, expect, test } from 'bun:test';
import { listOpenGates, resolveMessageEffect } from '../../src/index.ts';
import {
  completePhase,
  createHarness,
  createTask,
  type Harness,
  linkSession,
  proposePlan,
  pullRequest,
  reachReviewGate,
  reachShipping,
  readyWorktree,
  shipAndMerge,
} from '../harness.ts';

function effectOf(harness: Harness, taskId: string) {
  return resolveMessageEffect(harness.state, harness.task(taskId));
}

describe('questions and messages', () => {
  test('an agent question waits for the answer and resolves the waiting tool call', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    harness.send({ type: 'agent.ask', runId: run.id, gateId: 'q1', question: 'Which tab?', context: null });
    expect(harness.openGate(taskId).purpose).toBe('agent_question');
    harness.send({ type: 'gate.answer', gateId: 'q1', decision: 'answer', response: 'The second.' });
    expect(harness.lastEffect('question.resolve').gateId).toBe('q1');
    expect(harness.activeRun(taskId).id).toBe(run.id);
  });

  test('a message to a working agent steers it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    expect(effectOf(harness, taskId)).toBe('steer');
    harness.send({ type: 'task.message', taskId, text: 'Use the new API.' });
    expect(harness.lastEffect('run.steer')).toEqual({
      kind: 'run.steer',
      runId: run.id,
      text: 'Use the new API.',
    });
  });

  test('a message while a question is open makes the question historical and reaches the agent', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    harness.send({ type: 'agent.ask', runId: run.id, gateId: 'q1', question: 'Which?', context: null });
    expect(effectOf(harness, taskId)).toBe('supersede_question');
    harness.send({ type: 'task.message', taskId, text: 'Use the cheaper one.' });
    expect(harness.state.gates.q1).toMatchObject({
      status: 'withdrawn',
      supersededBy: 'Use the cheaper one.',
    });
    expect(harness.lastEffect('question.resolve').gateId).toBe('q1');
    expect(harness.activeRun(taskId).id).toBe(run.id);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(harness.task(taskId).activity.at(-1)?.text).toBe(
      'Replied in the chat instead of answering: Which?'
    );
  });

  test('a message at the review gate replaces the gate with a fix', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    expect(effectOf(harness, taskId)).toBe('request_changes');
    harness.send({ type: 'task.message', taskId, text: 'Rename the prop.' });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(harness.task(taskId).stage).toBe('fixing');
    expect(harness.task(taskId).fixFor).toBe('you');
  });

  test('a message at the merge gate withdraws it before any change is made', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    expect(harness.openGate(taskId).kind).toBe('merge');
    expect(effectOf(harness, taskId)).toBe('send_back');
    harness.send({ type: 'task.message', taskId, text: 'One more thing.' });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(harness.task(taskId).stage).toBe('fixing');
  });

  test('a message on a failed task retries it with the message as guidance', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({ type: 'effect.fail', taskId, title: 'Broke', detail: 'x' });
    expect(effectOf(harness, taskId)).toBe('retry');
    harness.send({ type: 'task.message', taskId, text: 'Try the other file.' });
    expect(harness.activeRun(taskId).prompt).toContain('Guidance from the human: Try the other file.');
  });

  test('a question whose agent died is answered by retrying the step with the answer', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const builder = harness.activeRun(taskId);
    harness.send({ type: 'agent.ask', runId: builder.id, gateId: 'q1', question: 'Which?', context: null });
    harness.send({ type: 'run.end', runId: builder.id, outcome: 'failed', summary: 'crash' });
    expect(harness.state.gates.q1?.status).toBe('withdrawn');
    expect(harness.activeRun(taskId).role).toBe('builder');
  });
});

describe('what a message does', () => {
  test('a merged task takes a message as a new round, a closed one takes none, and a plan gate or a check round reads it as revision or fix', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(effectOf(harness, taskId)).toBe('steer');
    proposePlan(harness, taskId);
    completePhase(harness, taskId);
    completePhase(harness, taskId);
    expect(harness.task(taskId).stage).toBe('checking');
    expect(effectOf(harness, taskId)).toBe('fix');
    const settled = createTask(harness, { request: 'Finished' });
    shipAndMerge(harness, settled);
    expect(effectOf(harness, settled)).toBe('new_round');
    harness.send({ type: 'task.complete', taskId: settled });
    expect(effectOf(harness, settled)).toBe('closed');
    expect(() => harness.send({ type: 'task.message', taskId: settled, text: 'More?' })).toThrow(
      'This task is finished. Start a new one.'
    );
  });
});

describe('daemon hand-offs', () => {
  test('a steer that missed its session restarts the current step with the message, never steers again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    completePhase(harness, taskId);
    linkSession(harness, taskId, 'builder-2');
    const second = harness.activeRun(taskId);
    const steers = harness.effectsOf('run.steer').length;
    harness.send({ type: 'message.deliver', taskId, text: 'Also handle RTL.' });
    const next = harness.activeRun(taskId);
    expect(next.id).not.toBe(second.id);
    expect(next.sessionId).toBe('builder-2');
    expect(next.prompt).toContain('The human added: Also handle RTL.');
    expect(harness.effectsOf('run.steer')).toHaveLength(steers);
  });
});

describe('messages before work starts', () => {
  test('a message sent before planning starts reaches the planner', () => {
    const harness = createHarness();
    const first = createTask(harness);
    const second = createTask(harness, { request: 'Second', waitsOn: [first] });
    expect(harness.task(second).stage).toBe('queued');
    expect(effectOf(harness, second)).toBe('kept');
    harness.send({ type: 'task.message', taskId: second, text: 'Use the blue variant.' });
    shipAndMerge(harness, first);
    readyWorktree(harness, second);
    expect(harness.activeRun(second).prompt).toContain('The human added since:\n- Use the blue variant.');
  });
});

describe('questions that lose their agent', () => {
  test('a question is withdrawn when its agent is stopped, so a waiting task can start later', () => {
    const harness = createHarness();
    const parent = createTask(harness, { request: 'Parent' });
    const child = createTask(harness, { request: 'Child' });
    harness.send({
      type: 'agent.ask',
      runId: harness.activeRun(child).id,
      gateId: 'q1',
      question: 'Which?',
      context: null,
    });
    harness.send({ type: 'task.wait_on', taskId: child, waitsOn: [parent] });
    expect(harness.state.gates.q1?.status).toBe('withdrawn');
    expect(harness.effectsOf('question.resolve').map((effect) => effect.gateId)).toContain('q1');
    shipAndMerge(harness, parent);
    expect(harness.task(child).stage).toBe('triage');
  });

  test('a new agent step clears a failure that no longer applies', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({ type: 'effect.fail', taskId, title: 'Could not read the pull request', detail: 'gh' });
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'failing' }) });
    expect(harness.activeRun(taskId).role).toBe('fixer');
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });
});
