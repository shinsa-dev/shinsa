import { describe, expect, test } from 'bun:test';
import { listWaitsOn, resolveLiveness, resolveQueue } from '../../src/index.ts';
import { buildAll, createHarness, createTask, PASSING } from '../harness.ts';

describe('scheduling', () => {
  test('every independent task starts at once: there is no cap on agents', () => {
    const harness = createHarness();
    const tasks = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((intent) =>
      createTask(harness, { intent })
    );
    for (const taskId of tasks) {
      expect(harness.activeRun(taskId).status).toBe('running');
      expect(listWaitsOn(harness.state, harness.task(taskId))).toEqual([]);
    }
    expect(harness.effectsOf('run.execute')).toHaveLength(tasks.length);
    expect(resolveQueue(harness.state, 0).working).toHaveLength(tasks.length);
  });

  test('a stored agent limit from an older version is ignored', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { maxConcurrentRuns: 1 } as never });
    const first = createTask(harness, { intent: 'One' });
    const second = createTask(harness, { intent: 'Two' });
    expect(harness.activeRun(first).status).toBe('running');
    expect(harness.activeRun(second).status).toBe('running');
  });

  test('every open task always has something moving it forward', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    for (const task of Object.values(harness.state.tasks)) {
      expect(resolveLiveness(harness.state, task)).not.toBeNull();
    }
  });
});
