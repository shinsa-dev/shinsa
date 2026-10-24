import { describe, expect, test } from 'bun:test';
import { isTaskSettled, listActiveRuns, resolveTaskProgress } from '../../src/index.ts';
import { createHarness, type Harness, registerRepo, verifySetup } from '../harness.ts';

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
  harness.send({ type: 'agent.answer', runId: harness.activeRun(taskId).id, answer: text });
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

  test('the answer settles the task as done and is kept', () => {
    const { harness, taskId } = ask();
    answer(harness, taskId);
    const task = harness.task(taskId);
    expect(task).toMatchObject({ stage: 'done', stageReason: 'answered your question' });
    expect(task.answer).toBe('It retries three times in `retry()`.');
    expect(task.activity.map((entry) => entry.text)).toContain('Answered the question');
    expect(task.activity.map((entry) => entry.text)).not.toContain('Marked done');
    expect(isTaskSettled(task)).toBe(true);
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
  });

  test('a follow-up reopens the question on the same session', () => {
    const { harness, taskId } = ask();
    harness.send({ type: 'run.link', runId: harness.activeRun(taskId).id, sessionId: 'answerer-1' });
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
