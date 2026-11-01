import { describe, expect, test } from 'bun:test';
import { listOpenGates, resolveQueue } from '../../src/index.ts';
import { createHarness, createTask, type Harness, proposePlan, reachReviewGate } from '../harness.ts';

function queueOf(harness: Harness) {
  return resolveQueue(harness.state, harness.now);
}

describe('snoozing a task', () => {
  test('a task waiting for review leaves Needs you and keeps its stage and gate', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const gate = harness.openGate(taskId);
    const briefings = harness.effectsOf('briefing.request').length;

    harness.send({ type: 'task.snooze', taskId });

    const task = harness.task(taskId);
    expect(task.snoozed).toEqual({ at: harness.now });
    expect(task.stage).toBe('awaiting_review');
    expect(listOpenGates(harness.state, taskId).map((open) => open.id)).toEqual([gate.id]);
    expect(queueOf(harness).ready).toEqual([]);
    expect(queueOf(harness).snoozed.map((entry) => entry.id)).toEqual([taskId]);
    expect(task.activity.at(-1)?.text).toBe('Snoozed: it keeps its place, out of Needs you and Home');
    expect(harness.effectsOf('briefing.request')).toHaveLength(briefings + 1);
  });

  test('a working task keeps its agent, leaves In progress, and the gate it reaches stays quiet', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    expect(queueOf(harness).working.map((entry) => entry.id)).toEqual([taskId]);

    harness.send({ type: 'task.snooze', taskId });
    expect(harness.activeRun(taskId).id).toBe(run.id);
    expect(queueOf(harness).working).toEqual([]);

    reachReviewGate(harness, taskId);
    expect(harness.task(taskId).stage).toBe('awaiting_review');
    expect(queueOf(harness).ready).toEqual([]);
    expect(queueOf(harness).snoozed.map((entry) => entry.id)).toEqual([taskId]);
  });

  test('a snoozed task waiting on another task is listed as snoozed, not waiting', () => {
    const harness = createHarness();
    const first = createTask(harness);
    const second = createTask(harness, { waitsOn: [first] });
    expect(queueOf(harness).waiting.map((entry) => entry.id)).toEqual([second]);

    harness.send({ type: 'task.snooze', taskId: second });
    expect(queueOf(harness).waiting).toEqual([]);
    expect(queueOf(harness).snoozed.map((entry) => entry.id)).toEqual([second]);
  });

  test('a snoozed backlog task is listed as snoozed, not in the backlog', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { backlog: true });
    proposePlan(harness, taskId);
    harness.send({ type: 'task.snooze', taskId });
    expect(queueOf(harness).backlog).toEqual([]);
    expect(queueOf(harness).snoozed.map((entry) => entry.id)).toEqual([taskId]);
  });

  test('Unsnooze puts the task back where it was, and repeats change nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    harness.send({ type: 'task.snooze', taskId });
    const events = harness.events.length;
    harness.send({ type: 'task.snooze', taskId });
    expect(harness.events).toHaveLength(events);

    harness.send({ type: 'task.unsnooze', taskId });
    expect(harness.task(taskId).snoozed).toBeNull();
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Unsnoozed');
    expect(queueOf(harness).ready.map((entry) => entry.task.id)).toEqual([taskId]);
    expect(queueOf(harness).snoozed).toEqual([]);

    const after = harness.events.length;
    harness.send({ type: 'task.unsnooze', taskId });
    expect(harness.events).toHaveLength(after);
  });

  test('a finished task cannot be snoozed', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.cancel', taskId });
    expect(() => harness.send({ type: 'task.snooze', taskId })).toThrow('This task is finished.');
  });

  test('a snoozed task that settles leaves the snoozed list', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.snooze', taskId });
    harness.send({ type: 'task.cancel', taskId });
    expect(queueOf(harness).snoozed).toEqual([]);
  });
});
