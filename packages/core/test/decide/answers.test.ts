import { describe, expect, test } from 'bun:test';
import {
  isTaskClosed,
  isTaskComplete,
  isTaskSettled,
  listActiveRuns,
  listOpenGates,
  resolveCurrentRound,
  resolveMessageEffect,
  resolveQueue,
  resolveTaskProgress,
} from '../../src/index.ts';
import { approve, createHarness, type Harness, registerRepo, verifySetup } from '../harness.ts';

function ask(harness: Harness = createHarness()) {
  const repoId = registerRepo(harness);
  harness.send({ type: 'task.create', request: 'How does the export retry?', repoId: null, mode: 'ask' });
  const taskId = Object.keys(harness.state.tasks).at(-1) ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: 'How the export retries',
    repoId,
    size: 'small',
    branch: 'ask/export-retry',
    waitsOn: [],
  });
  verifySetup(harness, taskId);
  return { harness, taskId };
}

function answer(harness: Harness, taskId: string, text = 'It retries three times in `retry()`.') {
  harness.send({ type: 'agent.deliver', runId: harness.activeRun(taskId).id, step: 'answer', body: text });
}

describe('ask mode', () => {
  test('a question gets no branch, worktree, plan or pull request; an answerer reads the repository', () => {
    const { harness, taskId } = ask();
    const task = harness.task(taskId);
    expect(task).toMatchObject({ mode: 'ask', branch: null, worktreePath: null, stage: 'answering' });
    expect(task.activity[0]?.text).toBe('Asked a question');
    expect(task.activity.find((entry) => entry.kind === 'set_up')?.text).toBe(
      'Set up as a question about paywall-next'
    );
    const run = harness.activeRun(taskId);
    expect(run.role).toBe('answerer');
    expect(run.prompt).toContain('This task only answers a question: there is no worktree');
    expect(run.prompt).toContain('The repository is checked out at `/code/paywall-next`');
    expect(run.prompt).not.toContain('You are in a git worktree');
    expect(harness.effectsOf('worktree.create')).toHaveLength(0);
  });

  test('the answer waits as answered, in front of you, until you close it', () => {
    const { harness, taskId } = ask();
    answer(harness, taskId);
    const task = harness.task(taskId);
    expect(task).toMatchObject({ stage: 'answered', stageReason: 'answered your question' });
    expect(task.result).toMatchObject({ step: 'answer', body: 'It retries three times in `retry()`.' });
    expect(task.activity.map((entry) => entry.text)).toContain('Answered the question');
    expect(isTaskSettled(task)).toBe(false);
    expect(isTaskComplete(task)).toBe(true);
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    expect(harness.openGate(taskId)).toMatchObject({ type: 'result', title: 'Read the answer' });
    expect(resolveQueue(harness.state, harness.now).ready.map((entry) => entry.gate.type)).toEqual([
      'result',
    ]);
  });

  test('closing the answer settles the task as done, and it still takes a follow-up', () => {
    const { harness, taskId } = ask();
    answer(harness, taskId);
    approve(harness, taskId);
    const task = harness.task(taskId);
    expect(task).toMatchObject({ stage: 'done', stageReason: 'closed by you' });
    expect(isTaskSettled(task)).toBe(true);
    expect(isTaskClosed(task)).toBe(false);
    const texts = task.activity.map((entry) => entry.text);
    expect(texts).toContain('Closed the task');
    expect(texts).not.toContain('Marked done');
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    harness.send({ type: 'task.message', taskId, text: 'And on a timeout?' });
    expect(harness.task(taskId).stage).toBe('answering');
  });

  test('a message on an answered question asks a follow-up and withdraws the gate', () => {
    const { harness, taskId } = ask();
    answer(harness, taskId);
    expect(resolveMessageEffect(harness.state, harness.task(taskId))).toBe('follow_up');
    harness.send({ type: 'task.message', taskId, text: 'And on a timeout?' });
    expect(harness.task(taskId)).toMatchObject({
      stage: 'answering',
      stageReason: 'answering your follow-up',
    });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    answer(harness, taskId, 'It gives up after a minute.');
    expect(harness.task(taskId).stage).toBe('answered');
    expect(listOpenGates(harness.state, taskId).map((gate) => gate.type)).toEqual(['result']);
  });

  test('a new round on an answered question closes it and starts the round', () => {
    const { harness, taskId } = ask();
    answer(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'Make it retry five times.', kind: 'new_round' });
    const task = harness.task(taskId);
    expect(resolveCurrentRound(task).number).toBe(2);
    expect(task.stage).not.toBe('answered');
    expect(listOpenGates(harness.state, taskId).filter((gate) => gate.type === 'result')).toHaveLength(0);
  });

  test('an agent on your behalf can ask an answered question a follow-up, but not close it with new work', () => {
    const { harness, taskId } = ask();
    answer(harness, taskId);
    harness.send(
      { type: 'task.message', taskId, text: 'Make it retry five times.', kind: 'new_round' },
      { onBehalf: true, byTask: 'other' }
    );
    expect(harness.task(taskId).stage).toBe('answered');
    expect(listOpenGates(harness.state, taskId).map((gate) => gate.type)).toEqual(['result']);
    harness.send(
      { type: 'task.message', taskId, text: 'And on a timeout?' },
      { onBehalf: true, byTask: 'other' }
    );
    expect(harness.task(taskId).stage).toBe('answering');
    answer(harness, taskId, 'It gives up after a minute.');
    expect(listOpenGates(harness.state, taskId).map((gate) => gate.type)).toEqual(['result']);
  });

  test('an agent on your behalf can neither mark an answered question done nor cancel it', () => {
    const { harness, taskId } = ask();
    answer(harness, taskId);
    for (const type of ['task.complete', 'task.cancel'] as const) {
      expect(() => harness.send({ type, taskId }, { onBehalf: true, byTask: 'other' })).toThrow(
        /waits for (a decision only the human makes|you|the human)/
      );
    }
    expect(harness.task(taskId).stage).toBe('answered');
    expect(listOpenGates(harness.state, taskId).map((gate) => gate.type)).toEqual(['result']);
  });

  test('marking an answered question done withdraws the gate', () => {
    const { harness, taskId } = ask();
    answer(harness, taskId);
    harness.send({ type: 'task.complete', taskId });
    expect(harness.task(taskId)).toMatchObject({ stage: 'done', stageReason: 'marked done by you' });
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain('Marked done');
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });

  test('the result gate only closes', () => {
    const { harness, taskId } = ask();
    answer(harness, taskId);
    const gateId = harness.openGate(taskId).id;
    expect(() => harness.send({ type: 'gate.answer', gateId, decision: 'reject', response: null })).toThrow(
      'Close the task once you have read the result.'
    );
  });

  test('a follow-up reopens the question on the same session', () => {
    const { harness, taskId } = ask();
    harness.send({
      type: 'run.link',
      runId: harness.activeRun(taskId).id,
      sessionId: 'answerer-1',
      provider: 'claude',
    });
    answer(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'And on a timeout?' });
    const run = harness.activeRun(taskId);
    expect(harness.task(taskId)).toMatchObject({
      stage: 'answering',
      stageReason: 'answering your follow-up',
    });
    expect(run).toMatchObject({ role: 'answerer', sessionId: 'answerer-1' });
    expect(run.prompt).toContain('The human followed up:\nAnd on a timeout?');
  });

  test('a finished build task still refuses messages', () => {
    const { harness, taskId } = ask();
    harness.send({ type: 'task.cancel', taskId });
    expect(() => harness.send({ type: 'task.message', taskId, text: 'Hm?' })).toThrow(
      'This task is finished.'
    );
  });

  test('retrying or messaging an answer in progress starts the answerer again', () => {
    const { harness, taskId } = ask();
    const first = harness.activeRun(taskId);
    harness.send({ type: 'effect.fail', taskId, title: 'Broke', detail: 'x' });
    harness.send({ type: 'task.retry', taskId });
    expect(harness.activeRun(taskId).id).not.toBe(first.id);
    harness.send({ type: 'message.deliver', taskId, text: 'Look at the cron too.' });
    expect(harness.activeRun(taskId).prompt).toContain('Look at the cron too.');
  });

  test('only the answerer can answer, and a question shows two steps', () => {
    const { harness, taskId } = ask();
    expect(
      resolveTaskProgress(harness.task(taskId)).phases.map((phase) => [phase.title, phase.status])
    ).toEqual([
      ['Find the repository', 'done'],
      ['Answer', 'active'],
    ]);
    answer(harness, taskId);
    expect(resolveTaskProgress(harness.task(taskId)).phases.map((phase) => phase.status)).toEqual([
      'done',
      'done',
    ]);
  });
});
