import { describe, expect, test } from 'bun:test';
import { isTaskLive } from '../../src/decide/liveness.ts';
import { resolveMessageEffect } from '../../src/decide/messages.ts';
import { listActiveRuns, listOpenGates, MAX_AUTO_RETRIES } from '../../src/index.ts';
import { createHarness, createTask, fireRetry, type Harness, proposePlan } from '../harness.ts';

const MINUTE = 60_000;

function breakTask(harness: Harness, taskId: string, detail = 'disk full') {
  return harness.send({ type: 'effect.fail', taskId, title: 'Could not set up the worktree', detail });
}

function failing() {
  const harness = createHarness();
  const taskId = createTask(harness);
  breakTask(harness, taskId);
  return { harness, taskId };
}

describe('automatic retries', () => {
  test('a failure arms a retry instead of a gate, and the task counts as live and waiting', () => {
    const { harness, taskId } = failing();
    const task = harness.task(taskId);
    expect(listOpenGates(harness.state, taskId)).toEqual([]);
    expect(listActiveRuns(harness.state, taskId)).toEqual([]);
    expect(task.autoRetry).toEqual({
      at: harness.now + MINUTE,
      attempt: 1,
      title: 'Could not set up the worktree',
      detail: 'disk full',
      runId: null,
      cause: null,
      milestone: expect.stringMatching(/^milestone:/),
      status: 'armed',
    });
    expect(isTaskLive(harness.state, task)).toBe(true);
    expect(task.activity.at(-1)).toMatchObject({
      kind: 'failure',
      text: 'Could not set up the worktree; retrying in a minute (1 of 10)',
      detail: 'disk full',
    });
  });

  test('the retry waits for its time, then restarts the step as Retry does', () => {
    const { harness, taskId } = failing();
    expect(harness.send({ type: 'task.auto_retry', taskId }).events).toEqual([]);
    fireRetry(harness, taskId);
    expect(harness.task(taskId).autoRetry?.status).toBe('spent');
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'plan' });
    expect(harness.send({ type: 'task.auto_retry', taskId }).events).toEqual([]);
    expect(harness.send({ type: 'task.auto_retry', taskId: 'missing' }).events).toEqual([]);
  });

  test('each retry without progress waits longer, and after ten the failure gate opens and says so', () => {
    const { harness, taskId } = failing();
    const waits: number[] = [];
    for (let attempt = 1; attempt <= MAX_AUTO_RETRIES; attempt += 1) {
      const retry = harness.task(taskId).autoRetry;
      expect(retry?.attempt).toBe(attempt);
      waits.push(((retry?.at ?? 0) - harness.now) / MINUTE);
      fireRetry(harness, taskId);
      breakTask(harness, taskId);
    }
    expect(waits).toEqual([1, 5, 15, 30, 60, 60, 60, 60, 60, 60]);
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      'Could not set up the worktree; retrying in an hour (5 of 10)'
    );
    expect(harness.task(taskId).autoRetry?.status).toBe('spent');
    expect(harness.openGate(taskId)).toMatchObject({
      type: 'failure',
      title: 'Could not set up the worktree',
      body: 'disk full Shinsa already retried it 10 times on its own.',
    });
  });

  test('progress since the last retry starts the count again', () => {
    const { harness, taskId } = failing();
    fireRetry(harness, taskId);
    breakTask(harness, taskId);
    expect(harness.task(taskId).autoRetry?.attempt).toBe(2);
    fireRetry(harness, taskId);
    proposePlan(harness, taskId);
    breakTask(harness, taskId);
    expect(harness.task(taskId).autoRetry?.attempt).toBe(1);
  });

  test('Retry now restarts the step at once and starts the count again', () => {
    const { harness, taskId } = failing();
    fireRetry(harness, taskId);
    breakTask(harness, taskId);
    harness.send({ type: 'task.retry', taskId });
    expect(harness.task(taskId).autoRetry).toBeNull();
    expect(harness.activeRun(taskId)).toMatchObject({ purpose: 'plan' });
    breakTask(harness, taskId);
    expect(harness.task(taskId).autoRetry?.attempt).toBe(1);
  });

  test('a message retries at once with your words as guidance and starts the count again', () => {
    const { harness, taskId } = failing();
    expect(resolveMessageEffect(harness.state, harness.task(taskId))).toBe('retry');
    harness.send({ type: 'task.message', taskId, text: 'Use the other disk.' });
    expect(harness.task(taskId).autoRetry).toBeNull();
    expect(harness.activeRun(taskId).prompt).toContain('Use the other disk.');
  });

  test('a message sent on your behalf retries too, but keeps the count', () => {
    const { harness, taskId } = failing();
    harness.send({ type: 'task.message', taskId, text: 'Try again.' }, { onBehalf: true, byTask: 'other' });
    expect(harness.task(taskId).autoRetry).toMatchObject({ attempt: 1, status: 'spent' });
    expect(harness.activeRun(taskId).prompt).toContain('Try again.');
  });

  test('your Pause holds the task with its gate and drops the pending retry', () => {
    const { harness, taskId } = failing();
    harness.send({ type: 'task.pause', taskId });
    expect(harness.task(taskId).autoRetry?.status).toBe('spent');
    expect(harness.openGate(taskId)).toMatchObject({ type: 'failure', cause: 'paused' });
    expect(harness.send({ type: 'task.auto_retry', taskId }).events).toEqual([]);
  });

  test('cancelling the task drops the pending retry', () => {
    const { harness, taskId } = failing();
    harness.send({ type: 'task.cancel', taskId });
    expect(harness.task(taskId).autoRetry?.status).toBe('spent');
    harness.advance(MINUTE);
    expect(harness.send({ type: 'task.auto_retry', taskId }).events).toEqual([]);
  });
});
