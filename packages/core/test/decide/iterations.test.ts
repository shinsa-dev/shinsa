import { describe, expect, test } from 'bun:test';
import {
  applyEvent,
  type CommandOf,
  createState,
  isReplyingRun,
  type ReviewComment,
  type RunDelegation,
  resolveMessageEffect,
  selectOpenIteration,
} from '../../src/index.ts';
import {
  buildAll,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  PASSING,
  PLAN,
  proposePlan,
  REPLY,
  reachReviewGate,
  registerRepo,
} from '../harness.ts';

const DELEGATION = { parentRunId: 'parent' } as RunDelegation;

const COMMENT: ReviewComment = { path: 'src/a.ts', side: 'new', line: 2, endLine: null, text: 'Why?' };

function atReview() {
  const harness = createHarness();
  const taskId = createTask(harness);
  reachReviewGate(harness, taskId);
  return { harness, taskId };
}

function atPlanGate() {
  const harness = createHarness();
  registerRepo(harness);
  harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
  const taskId = createTask(harness);
  proposePlan(harness, taskId);
  return { harness, taskId };
}

function askForChanges(
  harness: Harness,
  taskId: string,
  response: string | null,
  comments: ReviewComment[] = []
) {
  harness.send({
    type: 'gate.answer',
    gateId: harness.openGate(taskId).id,
    decision: 'revise',
    response,
    comments,
  });
}

function completeFix(harness: Harness, taskId: string, reply = REPLY) {
  harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Done.', reply });
}

describe('your requests and their replies', () => {
  test('asking for changes at the review gate opens a request with your words and line comments', () => {
    const { harness, taskId } = atReview();
    askForChanges(harness, taskId, ' Move Slack under Remote access. ', [COMMENT, COMMENT]);
    expect(harness.task(taskId).iterations).toEqual([
      {
        id: expect.any(String),
        round: 1,
        requests: [{ text: 'Move Slack under Remote access.', comments: 2, at: expect.any(Number) }],
        reply: null,
        runId: null,
        repliedAt: null,
      },
    ]);
  });

  test('line comments alone open a request with no words', () => {
    const { harness, taskId } = atReview();
    askForChanges(harness, taskId, null, [COMMENT]);
    expect(harness.task(taskId).iterations?.[0]?.requests).toEqual([
      { text: '', comments: 1, at: expect.any(Number) },
    ]);
  });

  test('the fix that answers it must reply, and the reply closes the request', () => {
    const { harness, taskId } = atReview();
    askForChanges(harness, taskId, 'Rename it.');
    const run = harness.activeRun(taskId);
    expect(() => harness.send({ type: 'agent.complete_fix', runId: run.id, summary: 'Renamed.' })).toThrow(
      'so `reply` is required'
    );
    completeFix(harness, taskId);
    const [iteration] = harness.task(taskId).iterations ?? [];
    expect(iteration).toMatchObject({ reply: REPLY, runId: run.id, repliedAt: expect.any(Number) });
    expect(selectOpenIteration(harness.task(taskId))).toBeNull();
  });

  test('a fix nobody asked for refuses a reply', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    askForChanges(harness, taskId, 'Rename it.');
    completeFix(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: [] });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [{ severity: 'blocking', file: 'a.ts', line: 1, message: 'Broken.' }],
    });
    expect(harness.activeRun(taskId).purpose).toBe('fix');
    expect(() => completeFix(harness, taskId)).toThrow('Leave `reply` out');
  });

  test('a message at the review gate opens a request, and a later one opens the next', () => {
    const { harness, taskId } = atReview();
    harness.send({ type: 'task.message', taskId, text: 'Does it need a setting?' });
    completeFix(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: [] });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    harness.send({ type: 'task.message', taskId, text: 'Now move it.' });
    const iterations = harness.task(taskId).iterations ?? [];
    expect(iterations.map((iteration) => iteration.requests.map((request) => request.text))).toEqual([
      ['Does it need a setting?'],
      ['Now move it.'],
    ]);
    expect(iterations[0]?.id).not.toBe(iterations[1]?.id);
    completeFix(harness, taskId, { ...REPLY, headline: 'Moved it.' });
    expect(harness.task(taskId).iterations?.map((iteration) => iteration.reply?.headline)).toEqual([
      REPLY.headline,
      'Moved it.',
    ]);
  });

  test('a message while that fix runs joins its request, so one reply answers both', () => {
    const { harness, taskId } = atReview();
    askForChanges(harness, taskId, 'Move it.');
    harness.send({ type: 'task.message', taskId, text: 'And rename it.' });
    expect(harness.lastEffect('run.steer')).toMatchObject({ text: 'And rename it.' });
    const iterations = harness.task(taskId).iterations ?? [];
    expect(iterations).toHaveLength(1);
    expect(iterations[0]?.requests.map((request) => request.text)).toEqual(['Move it.', 'And rename it.']);
  });

  test('a message that steers the planner opens a request its plan must answer', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.message', taskId, text: 'Use the new API.' });
    expect(harness.lastEffect('run.steer')).toMatchObject({ text: 'Use the new API.' });
    const runId = harness.activeRun(taskId).id;
    expect(() => harness.send({ type: 'agent.propose_plan', runId, document: PLAN })).toThrow(
      'This `propose_plan` answers a message the human sent, so `reply` is required'
    );
    harness.send({ type: 'agent.propose_plan', runId, document: PLAN, reply: REPLY });
    expect(harness.task(taskId).iterations).toEqual([
      expect.objectContaining({
        requests: [expect.objectContaining({ text: 'Use the new API.' })],
        reply: REPLY,
        runId,
      }),
    ]);
  });

  test('a first plan that answers only the request refuses a reply', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(() =>
      harness.send({
        type: 'agent.propose_plan',
        runId: harness.activeRun(taskId).id,
        document: PLAN,
        reply: REPLY,
      })
    ).toThrow(
      'Leave `reply` out: it answers a message the human sent, and this `propose_plan` answers none.'
    );
  });

  test('asking for a new plan at the plan gate opens a request the revision answers', () => {
    const { harness, taskId } = atPlanGate();
    askForChanges(harness, taskId, 'Split the last phase.');
    expect(selectOpenIteration(harness.task(taskId))?.requests).toEqual([
      { text: 'Split the last phase.', comments: 0, at: expect.any(Number) },
    ]);
    proposePlan(harness, taskId);
    expect(harness.task(taskId).iterations?.[0]?.reply).toEqual(REPLY);
  });

  test('a message while the plan waits for you opens a request the revision answers', () => {
    const { harness, taskId } = atPlanGate();
    harness.send({ type: 'task.message', taskId, text: 'Drop the second phase.' });
    expect(selectOpenIteration(harness.task(taskId))?.requests[0]?.text).toBe('Drop the second phase.');
    proposePlan(harness, taskId);
    expect(selectOpenIteration(harness.task(taskId))).toBeNull();
  });

  test('a message that steers a build phase opens a request that phase must answer', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'Keep the old name.' });
    const runId = harness.activeRun(taskId).id;
    const phase: CommandOf<'agent.complete_phase'> = {
      type: 'agent.complete_phase',
      runId,
      summary: 'Did it.',
      spots: [],
      judgementCalls: [],
    };
    expect(() => harness.send(phase)).toThrow('This `complete_phase` answers a message the human sent');
    harness.send({ ...phase, reply: REPLY });
    expect(harness.task(taskId).iterations?.[0]).toMatchObject({ reply: REPLY, runId });
    expect(() => completePhase(harness, taskId)).not.toThrow();
  });

  test('a message that wakes an agent waiting on its delegation opens a request', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const parent = harness.activeRun(taskId);
    harness.send({
      type: 'agent.delegate',
      runId: parent.id,
      requestKey: 'copy',
      title: 'Check the copy',
      brief: 'Read the strings in src/copy.ts.',
      role: 'reviewer',
      mode: 'async',
      isolation: 'shared',
      baseCommit: null,
      provider: null,
      model: null,
    });
    harness.send({ type: 'run.end', runId: parent.id, outcome: 'completed', summary: 'Waiting.' });
    expect(resolveMessageEffect(harness.state, harness.task(taskId))).toBe('wake');
    harness.send({ type: 'task.message', taskId, text: 'Skip the copy check.' });
    expect(selectOpenIteration(harness.task(taskId))?.requests[0]?.text).toBe('Skip the copy check.');
  });

  test('a message to the reviewer opens no request', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    expect(harness.activeRun(taskId).role).toBe('reviewer');
    harness.send({ type: 'task.message', taskId, text: 'Look at the cache.' });
    expect(harness.lastEffect('run.steer')).toMatchObject({ text: 'Look at the cache.' });
    expect(harness.task(taskId).iterations).toBeUndefined();
  });

  test('a delegated run never answers a request', () => {
    expect(isReplyingRun({ role: 'agent', purpose: 'build', delegation: DELEGATION })).toBe(false);
    expect(isReplyingRun({ role: 'researcher', delegation: null })).toBe(true);
    expect(isReplyingRun({ role: 'agent', purpose: 'watch' })).toBe(false);
    expect(isReplyingRun({ role: 'agent' })).toBe(false);
  });

  test('events for a task that does not exist change nothing', () => {
    const state = createState();
    const requested = applyEvent(state, {
      type: 'iteration.requested',
      taskId: 'missing',
      iterationId: 'i1',
      round: 1,
      text: 'x',
      comments: 0,
      seq: 1,
      at: 1,
    });
    const answered = applyEvent(requested, {
      type: 'iteration.answered',
      taskId: 'missing',
      iterationId: 'i1',
      reply: REPLY,
      runId: 'r1',
      seq: 2,
      at: 2,
    });
    expect(answered.tasks).toEqual({});
  });
});
