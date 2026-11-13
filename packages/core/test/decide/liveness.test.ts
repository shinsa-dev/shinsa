import { describe, expect, test } from 'bun:test';
import { isTaskLive } from '../../src/decide/liveness.ts';
import { listOpenGates } from '../../src/index.ts';
import { createHarness, createTask, registerRepo, spendRetries } from '../harness.ts';

describe('liveness', () => {
  test('a task in an agent stage with nothing moving it retries on its own, each one on its own', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    const first = createTask(harness, { repoId });
    const second = createTask(harness, { repoId, request: 'Another task' });
    for (const taskId of [first, second]) {
      harness.replay({
        type: 'run.ended',
        runId: harness.activeRun(taskId).id,
        outcome: 'failed',
        summary: null,
      });
      expect(isTaskLive(harness.state, harness.task(taskId))).toBe(false);
    }
    harness.send({ type: 'runs.dispatch' });
    for (const taskId of [first, second]) {
      expect(listOpenGates(harness.state, taskId)).toEqual([]);
      expect(harness.task(taskId).autoRetry).toMatchObject({ title: 'This task got stuck', status: 'armed' });
      expect(isTaskLive(harness.state, harness.task(taskId))).toBe(true);
    }
  });

  test('a stuck task whose retries are spent gets a failure gate that says so', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { repoId: registerRepo(harness) });
    spendRetries(harness, taskId);
    harness.replay({
      type: 'run.ended',
      runId: harness.activeRun(taskId).id,
      outcome: 'failed',
      summary: null,
    });
    harness.send({ type: 'runs.dispatch' });
    expect(harness.openGate(taskId)).toMatchObject({ type: 'failure', title: 'This task got stuck' });
    expect(harness.openGate(taskId).body).toContain('already retried it 10 times on its own');
  });
});
