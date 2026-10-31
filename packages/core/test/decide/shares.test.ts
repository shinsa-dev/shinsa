import { describe, expect, test } from 'bun:test';
import { parseUserCommand } from '../../src/index.ts';
import { createHarness, createTask, type Harness, proposePlan } from '../harness.ts';

function publishes(harness: Harness, taskId: string) {
  return harness.effectsOf('share.publish').filter((effect) => effect.taskId === taskId).length;
}

describe('sharing a task', () => {
  test('sharing publishes the task once and records it in the activity', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.share', taskId });
    expect(harness.task(taskId).share).toEqual({ at: harness.now, url: null });
    expect(publishes(harness, taskId)).toBe(1);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'you',
      text: 'Shared this task by link',
    });
    expect(harness.send({ type: 'task.share', taskId }).events).toEqual([]);
    expect(publishes(harness, taskId)).toBe(1);
  });

  test('a change to what the task shows publishes it again, and a private change does not', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.share', taskId });
    harness.send({ type: 'agent.note', runId: harness.activeRun(taskId).id, note: 'Private thought.' });
    expect(publishes(harness, taskId)).toBe(1);
    proposePlan(harness, taskId);
    expect(publishes(harness, taskId)).toBe(2);
  });

  test('new evidence publishes the task again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({ type: 'task.share', taskId });
    harness.send({
      type: 'agent.attach_evidence',
      runId: harness.activeRun(taskId).id,
      kind: 'preview',
      title: 'Preview',
      uri: 'https://preview.example.dev',
    });
    expect(publishes(harness, taskId)).toBe(2);
  });

  test('renaming the project publishes every shared task again', () => {
    const harness = createHarness();
    const shared = createTask(harness);
    const other = createTask(harness, { request: 'Another task' });
    harness.send({ type: 'task.share', taskId: shared });
    const project = Object.values(harness.state.projects)[0];
    if (!project) throw new Error('no project');
    harness.send({ type: 'project.write', project: { ...project, name: 'Paywalls' } });
    expect(publishes(harness, shared)).toBe(2);
    expect(publishes(harness, other)).toBe(0);
  });

  test('a task that is not shared is never published', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    expect(publishes(harness, taskId)).toBe(0);
  });

  test('an automation has nothing to share', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.replay({
      type: 'task.created',
      taskId: 'home',
      request: 'Watch',
      repoId: null,
      priority: 'normal',
      planFirst: false,
      origin: null,
      auto: { shape: false, start: false, priority: false },
      watchHome: true,
    });
    expect(() => harness.send({ type: 'task.share', taskId: 'home' })).toThrow(
      'An automation has nothing to share.'
    );
    expect(harness.task(taskId).share).toBeUndefined();
  });

  test('only the human shares or stops sharing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const refusal = 'Only the human decides what is shared outside this machine.';
    expect(() => harness.send({ type: 'task.share', taskId }, { onBehalf: true })).toThrow(refusal);
    harness.send({ type: 'task.share', taskId });
    expect(() => harness.send({ type: 'task.unshare', taskId }, { onBehalf: true })).toThrow(refusal);
  });

  test('both commands are parsed from the page', () => {
    expect(parseUserCommand({ type: 'task.share', taskId: 't1' })).toEqual({
      type: 'task.share',
      taskId: 't1',
    });
    expect(parseUserCommand({ type: 'task.unshare', taskId: 't1' })).toEqual({
      type: 'task.unshare',
      taskId: 't1',
    });
  });
});

describe('the link', () => {
  test('is recorded once, and not after sharing stopped', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.share', taskId });
    const url = 'https://app.shinsa.dev/share/abc';
    harness.send({ type: 'share.record', taskId, url });
    expect(harness.task(taskId).share?.url).toBe(url);
    expect(harness.send({ type: 'share.record', taskId, url }).events).toEqual([]);
    harness.send({ type: 'task.unshare', taskId });
    expect(harness.send({ type: 'share.record', taskId, url }).events).toEqual([]);
    expect(harness.send({ type: 'share.record', taskId: 'missing', url }).events).toEqual([]);
    expect(harness.task(taskId).share).toBeNull();
  });
});

describe('stopping sharing', () => {
  test('removes the publication, drops a publish still queued and records it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.share', taskId });
    const decision = harness.send({ type: 'task.unshare', taskId });
    expect(decision.cancellations).toEqual([
      { taskId, kinds: ['share.publish'], reason: 'The task is no longer shared.' },
    ]);
    expect(harness.effectsOf('share.remove')).toEqual([{ kind: 'share.remove', taskId }]);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({ text: 'Stopped sharing this task' });
    proposePlan(harness, taskId);
    expect(publishes(harness, taskId)).toBe(1);
    expect(harness.send({ type: 'task.unshare', taskId }).events).toEqual([]);
  });
});
