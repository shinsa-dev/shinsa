import { describe, expect, test } from 'bun:test';
import { isTaskLive } from '../../src/decide/liveness.ts';
import { listActiveRuns, resolveQueue } from '../../src/index.ts';
import {
  buildAll,
  createHarness,
  createTask,
  failing,
  type Harness,
  PASSING,
  proposePlan,
} from '../harness.ts';

const MINUTE = 60_000;

function building() {
  const harness = createHarness();
  const taskId = createTask(harness);
  proposePlan(harness, taskId);
  return { harness, taskId };
}

function waitFor(
  harness: Harness,
  taskId: string,
  options: { minutes?: number; timeout?: number | null; attempts?: number | null; notes?: string } = {}
) {
  return harness.send({
    type: 'agent.wait_for',
    runId: harness.activeRun(taskId).id,
    checkInMinutes: options.minutes ?? 10,
    notes: options.notes ?? 'Check that the staging deploy finished.',
    timeoutMinutes: options.timeout ?? null,
    maxAttempts: options.attempts ?? null,
  });
}

function fire(harness: Harness, taskId: string) {
  const monitor = harness.task(taskId).monitor;
  if (!monitor) throw new Error('no monitor');
  return harness.send({ type: 'monitor.fire', taskId, monitorId: monitor.id, attempt: monitor.attempts + 1 });
}

describe('waiting with wait_for', () => {
  test('ends the run and keeps the task alive on the monitor', () => {
    const { harness, taskId } = building();
    const builder = harness.activeRun(taskId);
    waitFor(harness, taskId, { minutes: 15 });
    const task = harness.task(taskId);
    expect(task.monitor).toMatchObject({
      runId: builder.id,
      role: 'agent',
      phaseIndex: 0,
      notes: 'Check that the staging deploy finished.',
      attempts: 0,
      maxAttempts: 10,
      status: 'armed',
    });
    expect((task.monitor?.nextCheckAt ?? 0) - (task.monitor?.armedAt ?? 0)).toBe(15 * MINUTE);
    expect((task.monitor?.timeoutAt ?? 0) - (task.monitor?.armedAt ?? 0)).toBe(24 * 60 * MINUTE);
    expect(harness.state.runs[builder.id]).toMatchObject({ outcome: 'completed' });
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    expect(task.stage).toBe('building');
    expect(task.stageReason).toBe('waiting to check again');
    expect(isTaskLive(harness.state, task)).toBe(true);
    expect(resolveQueue(harness.state, 0).working.map((working) => working.id)).toContain(taskId);
    expect(task.activity.at(-1)).toMatchObject({
      kind: 'monitor',
      text: 'Set a check for later and ended its turn',
    });
  });

  test('a due check wakes the waiting agent on the same step by resuming its session', () => {
    const { harness, taskId } = building();
    harness.send({
      type: 'run.link',
      runId: harness.activeRun(taskId).id,
      sessionId: 'builder-1',
      provider: 'claude',
    });
    const waited = harness.activeRun(taskId);
    waitFor(harness, taskId);
    fire(harness, taskId);
    const run = harness.activeRun(taskId);
    expect(run).toMatchObject({
      role: 'agent',
      purpose: 'build',
      phaseIndex: 0,
      sessionId: 'builder-1',
      monitorId: harness.task(taskId).monitor?.id,
      continues: waited.id,
    });
    expect(run.prompt).toContain('Shinsa woke you to check again (check 1 of 10).');
    expect(run.prompt).toContain('call `wait_for` again');
    expect(run.prompt).not.toContain('last check');
    expect(harness.task(taskId).monitor).toMatchObject({ status: 'fired', attempts: 1 });
    expect(harness.task(taskId).stageReason).toBe('checking again');
  });

  test('waiting again carries the checks and the timeout over', () => {
    const { harness, taskId } = building();
    waitFor(harness, taskId, { attempts: 3, timeout: 120 });
    const first = harness.task(taskId).monitor;
    fire(harness, taskId);
    waitFor(harness, taskId, { minutes: 5, timeout: 9_000, attempts: 50 });
    expect(harness.task(taskId).monitor).toMatchObject({
      id: first?.id,
      attempts: 1,
      maxAttempts: 3,
      timeoutAt: first?.timeoutAt,
      status: 'armed',
    });
  });

  test('waiting again once the checks are used up ends the step and asks the human, as a timeout does', () => {
    const { harness, taskId } = building();
    waitFor(harness, taskId, { attempts: 1 });
    fire(harness, taskId);
    const woken = harness.activeRun(taskId);
    expect(woken.prompt).toContain(
      'This is your last check: if it is not ready, finish the step with what you know, or ask the human with `ask`. Waiting again ends your step and asks the human what to do.'
    );
    expect(woken.prompt).not.toContain('call `wait_for` again');
    waitFor(harness, taskId);
    expect(harness.state.runs[woken.id]).toMatchObject({
      outcome: 'completed',
      summary: 'The wait ran out.',
    });
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    expect(harness.task(taskId).monitor?.status).toBe('exhausted');
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({
      type: 'failure',
      cause: 'monitor',
      title: 'The agent’s wait ran out of checks',
    });
    expect(gate.body).toContain('The agent was waiting for: Check that the staging deploy finished.');
    expect(gate.body).toContain('The agent used all 1 check and still needed to wait.');
    harness.send({ type: 'task.retry', taskId });
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'build' });
    expect(harness.activeRun(taskId).monitorId).toBeUndefined();
  });

  test('waiting again after the timeout passed opens the timeout gate', () => {
    const { harness, taskId } = building();
    waitFor(harness, taskId, { minutes: 1, timeout: 2 });
    harness.send({ type: 'monitor.check_in_now', taskId });
    harness.advance(3 * MINUTE);
    waitFor(harness, taskId);
    expect(harness.openGate(taskId)).toMatchObject({ cause: 'monitor', title: 'The agent’s wait ran out' });
  });

  test('the timeout must come after the next check', () => {
    const { harness, taskId } = building();
    expect(() => waitFor(harness, taskId, { minutes: 30, timeout: 20 })).toThrow(
      'The next check must come before the wait times out.'
    );
  });

  test('the reviewer cannot wait, and the round agent waits on the step it was on', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    waitFor(harness, taskId);
    fire(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'plan' });
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    expect(() => waitFor(harness, taskId)).toThrow('A reviewer cannot do that.');
  });
});

describe('when the wait ends', () => {
  test('a wait past its timeout opens a gate that says what the agent waited for', () => {
    const { harness, taskId } = building();
    waitFor(harness, taskId, { minutes: 1, timeout: 2 });
    harness.advance(3 * MINUTE);
    fire(harness, taskId);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({ type: 'failure', cause: 'monitor', title: 'The agent’s wait ran out' });
    expect(gate.body).toContain('The agent was waiting for: Check that the staging deploy finished.');
    expect(gate.body).toContain('The wait ran out of time after 0 checks.');
    expect(harness.task(taskId).monitor?.status).toBe('exhausted');
    harness.send({ type: 'task.retry', taskId });
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'build' });
    expect(harness.task(taskId).monitor?.status).toBe('exhausted');
  });

  test('the gate counts the checks the agent made', () => {
    const { harness, taskId } = building();
    waitFor(harness, taskId, { minutes: 1, timeout: 3 });
    fire(harness, taskId);
    waitFor(harness, taskId, { minutes: 1 });
    harness.advance(5 * MINUTE);
    fire(harness, taskId);
    expect(harness.openGate(taskId).body).toContain('after 1 check.');
  });

  test('a message, a retry or a new step clears the wait', () => {
    const { harness, taskId } = building();
    waitFor(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'Skip the deploy check.' });
    expect(harness.task(taskId).monitor).toBeNull();
    expect(harness.activeRun(taskId).prompt).toContain('The human added: Skip the deploy check.');
  });

  test('settling the task clears the wait', () => {
    const { harness, taskId } = building();
    waitFor(harness, taskId);
    harness.send({ type: 'task.cancel', taskId });
    expect(harness.task(taskId).monitor).toBeNull();
  });

  test('a stale or repeated wake changes nothing', () => {
    const { harness, taskId } = building();
    waitFor(harness, taskId);
    const monitor = harness.task(taskId).monitor;
    if (!monitor) throw new Error('no monitor');
    expect(harness.send({ type: 'monitor.fire', taskId, monitorId: monitor.id, attempt: 5 }).events).toEqual(
      []
    );
    expect(harness.send({ type: 'monitor.fire', taskId, monitorId: 'other', attempt: 1 }).events).toEqual([]);
    expect(
      harness.send({ type: 'monitor.fire', taskId: 'gone', monitorId: monitor.id, attempt: 1 }).events
    ).toEqual([]);
    fire(harness, taskId);
    expect(harness.send({ type: 'monitor.fire', taskId, monitorId: monitor.id, attempt: 1 }).events).toEqual(
      []
    );
  });

  test('check now wakes the agent at once, and refuses when nothing waits', () => {
    const { harness, taskId } = building();
    expect(() => harness.send({ type: 'monitor.check_in_now', taskId })).toThrow(
      'Nothing here waits for a check.'
    );
    waitFor(harness, taskId);
    harness.send({ type: 'monitor.check_in_now', taskId });
    expect(harness.activeRun(taskId).monitorId).toBe(harness.task(taskId).monitor?.id);
  });

  test('the agent can wait too, and its wait survives a recovery of the woken run', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing() });
    waitFor(harness, taskId);
    fire(harness, taskId);
    const monitorId = harness.task(taskId).monitor?.id;
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'failed',
      summary: 'crash',
    });
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'fix', monitorId });
  });
});
