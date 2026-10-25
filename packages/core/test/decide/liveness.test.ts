import { describe, expect, test } from 'bun:test';
import { isTaskLive } from '../../src/decide/liveness.ts';
import { listOpenGates } from '../../src/index.ts';
import { createHarness, createTask, registerRepo } from '../harness.ts';

describe('liveness', () => {
  test('a task in an agent stage with nothing moving it gets a failure gate, each one on its own', () => {
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
      expect(listOpenGates(harness.state, taskId).map((gate) => gate.title)).toEqual(['This task got stuck']);
      expect(isTaskLive(harness.state, harness.task(taskId))).toBe(true);
    }
  });
});
