import { describe, expect, test } from 'bun:test';
import { isAskTask, type TaskShape } from '../../src/index.ts';
import { createHarness, registerRepo } from '../harness.ts';

function createShaped(shape: TaskShape) {
  const harness = createHarness();
  const repoId = registerRepo(harness);
  harness.send({ type: 'task.create', request: 'Look at the retry', repoId, shape });
  const task = Object.values(harness.state.tasks)[0];
  if (!task) throw new Error('The task was not created.');
  return task;
}

describe('stages', () => {
  test('only a task that answers a question and nothing else is an ask task', () => {
    expect(isAskTask(createShaped('answer'))).toBe(true);
    for (const shape of ['investigate', 'research', 'change', 'fix', 'operation'] as const) {
      expect(isAskTask(createShaped(shape))).toBe(false);
    }
  });
});
