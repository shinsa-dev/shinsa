import { describe, expect, test } from 'bun:test';
import {
  listActiveRuns,
  listOpenGates,
  resolveCurrentRound,
  resolveMessageEffect,
  resolveTaskRounds,
} from '../../src/index.ts';
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
  reachShipping,
  readyWorktree,
  registerRepo,
  shipAndMerge,
  verifySetup,
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
    expect(harness.openGate(taskId).type).toBe('question');
    harness.send({ type: 'gate.answer', gateId: 'q1', decision: 'reply', response: 'The second.' });
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
    expect(harness.openGate(taskId).type).toBe('merge');
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
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'build' });
  });
});

describe('what a message does', () => {
  test('a merged task takes a message as a follow-up, a closed one takes none, and a plan gate or a check round reads it as revision or fix', () => {
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
    expect(effectOf(harness, settled)).toBe('follow_up');
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
  test('a message sent before planning starts reaches the agent', () => {
    const harness = createHarness();
    const first = createTask(harness);
    const second = createTask(harness, { request: 'Second', waitsOn: [first] });
    expect(harness.task(second).stage).toBe('waiting_on_tasks');
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
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'fix' });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });
});

describe('the inbox', () => {
  test('a received message is kept in the inbox, refused when empty or on a closed task, and steers the agent once routed', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    expect(() => harness.send({ type: 'message.receive', taskId, text: '   ' })).toThrow(
      'Write a message first.'
    );
    const received = harness.send({ type: 'message.receive', taskId, text: '  Use the new API. ' });
    expect(received.effects).toEqual([]);
    const [message] = harness.task(taskId).inbox ?? [];
    expect(message).toMatchObject({ text: 'Use the new API.' });
    const messageId = message?.id ?? '';
    harness.send({ type: 'message.route', taskId, messageId, kind: 'feedback' });
    expect(harness.task(taskId).inbox).toEqual([]);
    expect(harness.lastEffect('run.steer')).toEqual({
      kind: 'run.steer',
      runId: run.id,
      text: 'Use the new API.',
    });
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      kind: 'message',
      detail: 'Use the new API.',
    });
    expect(harness.send({ type: 'message.route', taskId, messageId, kind: 'feedback' }).events).toEqual([]);

    const settled = createTask(harness, { request: 'Finished' });
    shipAndMerge(harness, settled);
    harness.send({ type: 'task.complete', taskId: settled });
    expect(() => harness.send({ type: 'message.receive', taskId: settled, text: 'More?' })).toThrow(
      'This task is finished. Start a new one.'
    );
  });

  test('a routed message takes the kind the classifier gave it, and one that can no longer be delivered is dropped with the reason', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'message.receive', taskId, text: 'Add an export button' });
    harness.send({ type: 'message.receive', taskId, text: 'Also dark mode' });
    const [first, second] = harness.task(taskId).inbox ?? [];
    harness.send({
      type: 'message.route',
      taskId,
      messageId: first?.id ?? '',
      kind: 'new_round',
      title: 'Add an export button',
      why: 'New work.',
      shape: 'change',
    });
    expect(harness.task(taskId).rounds?.at(-1)).toMatchObject({
      status: 'waiting',
      title: 'Add an export button',
    });
    expect(harness.task(taskId).inbox?.map((message) => message.text)).toEqual(['Also dark mode']);

    harness.send({
      type: 'message.drop',
      taskId,
      messageId: second?.id ?? '',
      reason: 'This task is finished.',
    });
    expect(harness.task(taskId).inbox).toEqual([]);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'shinsa',
      kind: 'failure',
      text: 'Could not deliver your message',
      detail: 'This task is finished.\n\nYour message: Also dark mode',
    });
    expect(harness.send({ type: 'message.drop', taskId, messageId: 'gone', reason: 'x' }).events).toEqual([]);
  });
});

function mergeWithSessions(harness: Harness, taskId: string) {
  proposePlan(harness, taskId);
  const phases = harness.task(taskId).plan?.document?.phases.length ?? 1;
  for (let index = 0; index < phases; index += 1) {
    linkSession(harness, taskId, `builder-${index + 1}`);
    completePhase(harness, taskId);
  }
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  linkSession(harness, taskId, 'reviewer-1');
  harness.send({ type: 'agent.report_review', runId: harness.activeRun(taskId).id, findings: [] });
  approve(harness, taskId);
  pushed(harness, taskId);
  harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
}

function answerFollowUp(
  harness: Harness,
  taskId: string,
  proposal: { request: string; why: string } | null = null
) {
  harness.send({
    type: 'agent.deliver',
    runId: harness.activeRun(taskId).id,
    step: 'answer',
    body: 'Because the project is called Superwall.',
    ...(proposal ? { proposal } : {}),
  });
}

function runOperation(harness: Harness) {
  const repoId = registerRepo(harness);
  harness.send({ type: 'task.create', request: 'Restructure projects/', repoId: null });
  const taskId = Object.keys(harness.state.tasks).at(-1) ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: 'Restructure projects/',
    repoId,
    size: 'small',
    branch: `chore/${taskId}`,
    waitsOn: [],
    shape: 'operation',
  });
  verifySetup(harness, taskId);
  harness.send({ type: 'worktree.ready', taskId, path: `/wt/${taskId}`, branch: `chore/${taskId}` });
  proposePlan(harness, taskId);
  approve(harness, taskId);
  linkSession(harness, taskId, 'operator-1');
  harness.send({
    type: 'agent.deliver',
    runId: harness.activeRun(taskId).id,
    step: 'operate',
    body: 'Moved 39 repositories into groups.',
  });
  return taskId;
}

describe('a message to a resting task', () => {
  test('thanks is recorded in the round and starts no round and no agent', () => {
    const harness = createHarness();
    const taskId = runOperation(harness);
    expect(harness.task(taskId).stage).toBe('done');
    const runs = Object.keys(harness.state.runs).length;
    harness.send({ type: 'task.message', taskId, text: 'sick thank you', kind: 'acknowledge' });
    const task = harness.task(taskId);
    expect(task).toMatchObject({ stage: 'done', stageReason: 'the operation finished' });
    expect(resolveTaskRounds(task)).toHaveLength(1);
    expect(Object.keys(harness.state.runs)).toHaveLength(runs);
    expect(task.activity.at(-1)).toMatchObject({
      kind: 'message',
      text: 'Sent a message',
      detail: 'sick thank you',
    });
  });

  test('an acknowledgement never steers a working agent, but answers an open question', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    harness.send({ type: 'task.message', taskId, text: 'ok', kind: 'acknowledge' });
    expect(harness.effectsOf('run.steer')).toHaveLength(0);
    expect(harness.activeRun(taskId).id).toBe(run.id);
    harness.send({ type: 'agent.ask', runId: run.id, gateId: 'q1', question: 'Ship it?', context: null });
    harness.send({ type: 'task.message', taskId, text: 'ok', kind: 'acknowledge' });
    expect(harness.state.gates.q1).toMatchObject({ status: 'withdrawn', supersededBy: 'ok' });
  });

  test('a question about a finished operation resumes the agent’s session in the same round', () => {
    const harness = createHarness();
    const taskId = runOperation(harness);
    expect(resolveMessageEffect(harness.state, harness.task(taskId))).toBe('follow_up');
    harness.send({ type: 'task.message', taskId, text: 'Why did you pick SW as the key?', kind: 'feedback' });
    const run = harness.activeRun(taskId);
    expect(run).toMatchObject({ role: 'answerer', sessionId: 'operator-1', resume: true });
    expect(run.prompt).toContain(
      'Round 1 of this task is finished, and the human asked a follow-up about it.'
    );
    expect(run.prompt).toContain('What round 1 was asked to do:\nRestructure projects/');
    expect(run.prompt).toContain('How the operation went:\nMoved 39 repositories into groups.');
    expect(run.prompt).toContain('The follow-up:\nWhy did you pick SW as the key?');
    expect(harness.task(taskId)).toMatchObject({
      stage: 'answering',
      stageReason: 'answering your follow-up',
    });
    expect(resolveCurrentRound(harness.task(taskId))).toMatchObject({ number: 1, status: 'active' });
    answerFollowUp(harness, taskId);
    const task = harness.task(taskId);
    expect(task).toMatchObject({ stage: 'done', stageReason: 'answered your follow-up' });
    expect(task.result).toMatchObject({ step: 'operate', body: 'Moved 39 repositories into groups.' });
    expect(resolveTaskRounds(task)).toEqual([
      expect.objectContaining({
        number: 1,
        status: 'finished',
        outcome: expect.objectContaining({ result: 'Moved 39 repositories into groups.' }),
      }),
    ]);
    expect(harness.state.runs[run.id]).toMatchObject({
      outcome: 'completed',
      summary: 'Answered your follow-up.',
    });
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
  });

  test('a message the classifier could not read resumes the last session of a merged change, never the reviewer’s, and the task rests merged again', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Fix the scroll' });
    mergeWithSessions(harness, taskId);
    expect(harness.task(taskId).stage).toBe('merged');
    harness.send({ type: 'task.message', taskId, text: 'Why the second phase?' });
    const run = harness.activeRun(taskId);
    expect(run).toMatchObject({
      role: 'answerer',
      sessionId: `builder-${harness.task(taskId).plan?.document?.phases.length}`,
    });
    expect(resolveTaskRounds(harness.task(taskId))).toHaveLength(1);
    expect(() => answerFollowUp(harness, taskId, { request: 'Redo it.', why: 'Better.' })).toThrow(
      'This answers a follow-up on finished work, so it proposes no change.'
    );
    answerFollowUp(harness, taskId);
    const task = harness.task(taskId);
    expect(task).toMatchObject({ stage: 'merged', stageReason: 'answered your follow-up' });
    expect(task.result ?? null).toBeNull();
    expect(resolveCurrentRound(task)).toMatchObject({ number: 1, status: 'merged' });
    expect(task.activity.filter((entry) => entry.text === 'Merged')).toHaveLength(1);
  });

  test('a follow-up that stops is retried, or restarted by a message, on its own session', () => {
    const harness = createHarness();
    const taskId = runOperation(harness);
    harness.send({ type: 'task.message', taskId, text: 'Why SW?', kind: 'feedback' });
    linkSession(harness, taskId, 'follow-up-1');
    harness.send({ type: 'effect.fail', taskId, title: 'Broke', detail: 'x' });
    harness.send({ type: 'task.retry', taskId });
    let run = harness.activeRun(taskId);
    expect(run).toMatchObject({ role: 'answerer', sessionId: 'follow-up-1' });
    expect(run.prompt).toContain('Answer the follow-up the human asked in this conversation.');
    harness.send({ type: 'effect.fail', taskId, title: 'Broke again', detail: 'x' });
    harness.send({ type: 'message.deliver', taskId, text: 'Short answer please.' });
    run = harness.activeRun(taskId);
    expect(run.prompt).toContain('The follow-up:\nShort answer please.');
  });

  test('new work starts a new round with the steps it was shaped with', () => {
    const harness = createHarness();
    const taskId = runOperation(harness);
    harness.send({
      type: 'task.message',
      taskId,
      text: 'How many repositories are in Archive?',
      kind: 'new_round',
      shape: 'answer',
      title: 'Count the archived repositories',
    });
    expect(resolveCurrentRound(harness.task(taskId))).toMatchObject({
      number: 2,
      pipeline: ['answer'],
      status: 'active',
    });
    verifySetup(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'answerer' });
    expect(harness.task(taskId).stage).toBe('answering');
  });
});
