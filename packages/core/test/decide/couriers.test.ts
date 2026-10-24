import { describe, expect, test } from 'bun:test';
import type { Task } from '../../src/index.ts';
import { createHarness, createTask, type Harness, proposePlan, registerRepo } from '../harness.ts';

function building() {
  const harness = createHarness();
  const taskId = createTask(harness);
  proposePlan(harness, taskId);
  return { harness, taskId };
}

function created(harness: Harness, before: Set<string>): Task[] {
  return Object.values(harness.state.tasks).filter((task) => !before.has(task.id));
}

function courier(
  harness: Harness,
  runId: string,
  options: { key?: string; request?: string; repoId?: string | null; thisWaits?: boolean } = {}
) {
  const before = new Set(Object.keys(harness.state.tasks));
  harness.send({
    type: 'agent.create_task',
    runId,
    requestKey: options.key ?? 'courier-1',
    request: options.request ?? 'Add the same banner to the settings page in the admin app.',
    repoId: options.repoId ?? null,
    thisWaits: options.thisWaits ?? false,
  });
  return created(harness, before);
}

function split(harness: Harness, runId: string, requests: string[], thisWaits = false) {
  const before = new Set(Object.keys(harness.state.tasks));
  harness.send({ type: 'agent.split_task', runId, requests, thisWaits });
  return created(harness, before);
}

describe('a courier task', () => {
  test('stands on its own, starts at once and is linked to the task that created it', () => {
    const { harness, taskId } = building();
    const builder = harness.activeRun(taskId);
    const [task] = courier(harness, builder.id);
    expect(task).toMatchObject({
      request: 'Add the same banner to the settings page in the admin app.',
      repoId: harness.task(taskId).repoId,
      priority: 'normal',
      stage: 'triage',
      createdBy: { kind: 'courier', taskId, runId: builder.id, requestKey: 'courier-1' },
    });
    expect(task?.parentTaskId).toBeUndefined();
    expect(harness.effectsOf('task.triage').at(-1)?.taskId).toBe(task?.id ?? '');
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      kind: 'delegation',
      text: 'Created a task: Add the same banner to the settings page in the admin app.',
      runId: builder.id,
    });
  });

  test('is created once for the same client request id', () => {
    const { harness, taskId } = building();
    const builder = harness.activeRun(taskId);
    expect(courier(harness, builder.id)).toHaveLength(1);
    expect(courier(harness, builder.id)).toHaveLength(0);
    expect(courier(harness, builder.id, { key: 'courier-2' })).toHaveLength(1);
  });

  test('goes to the repository it names', () => {
    const { harness, taskId } = building();
    const other = registerRepo(harness, 'admin', null);
    const [task] = courier(harness, harness.activeRun(taskId).id, { repoId: other });
    expect(task?.repoId).toBe(other);
  });

  test('a building task can wait on the task it creates, which holds only its merge', () => {
    const { harness, taskId } = building();
    const [task] = courier(harness, harness.activeRun(taskId).id, { thisWaits: true });
    expect(harness.task(taskId)).toMatchObject({ waitsOn: [task?.id ?? ''], stage: 'building' });
  });

  test('a planning task cannot wait on a task its own planner creates', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const planner = harness.activeRun(taskId);
    expect(() => courier(harness, planner.id, { thisWaits: true })).toThrow(
      'Only a task that is building can wait on a task it creates.'
    );
    expect(courier(harness, planner.id)).toHaveLength(1);
  });
});

describe('splitting the accepted plan', () => {
  test('creates the sub-tasks under this task exactly once per plan version', () => {
    const { harness, taskId } = building();
    const builder = harness.activeRun(taskId);
    const tasks = split(harness, builder.id, ['Port the header.', 'Port the footer.']);
    expect(tasks.map((task) => [task.request, task.parentTaskId, task.createdBy?.kind])).toEqual([
      ['Port the header.', taskId, 'split'],
      ['Port the footer.', taskId, 'split'],
    ]);
    expect(harness.task(taskId).splits).toEqual([
      { planVersion: 1, runId: builder.id, taskIds: tasks.map((task) => task.id), at: expect.any(Number) },
    ]);
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Split the accepted plan into 2 tasks');
    expect(split(harness, builder.id, ['Port the sidebar.'])).toEqual([]);
    expect(harness.task(taskId).splits).toHaveLength(1);
  });

  test('can make this task wait on its sub-tasks, so it merges after them', () => {
    const { harness, taskId } = building();
    const [task] = split(harness, harness.activeRun(taskId).id, ['Port the footer.'], true);
    expect(harness.task(taskId).waitsOn).toEqual([task?.id ?? '']);
    expect(harness.task(taskId).activity.at(-2)?.text).toBe('Split the accepted plan into 1 task');
  });

  test('takes one to eight tasks', () => {
    const { harness, taskId } = building();
    const builder = harness.activeRun(taskId);
    expect(() => split(harness, builder.id, [])).toThrow(
      'Split the plan into 1 to 8 tasks; this asked for 0.'
    );
    expect(() =>
      split(
        harness,
        builder.id,
        Array.from({ length: 9 }, (_, index) => `Part ${index}.`)
      )
    ).toThrow('this asked for 9');
  });
});
