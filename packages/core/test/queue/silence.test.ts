import { describe, expect, test } from 'bun:test';
import { isRunWaiting, type Run, resolveSilenceLevel } from '../../src/index.ts';
import { createHarness, createTask, type Harness, proposePlan } from '../harness.ts';

const MINUTE = 60_000;

function silentRun() {
  const harness = createHarness();
  const taskId = createTask(harness);
  const run = harness.activeRun(taskId);
  return { harness, taskId, runId: run.id };
}

function findRun(harness: Harness, runId: string): Run {
  const run = harness.state.runs[runId];
  if (!run) throw new Error(`no run ${runId}`);
  return run;
}

function delegate(harness: Harness, parentId: string, mode: 'async' | 'wait') {
  const before = new Set(Object.keys(harness.state.runs));
  harness.send({
    type: 'agent.delegate',
    runId: parentId,
    requestKey: `key-${mode}`,
    title: 'Check the copy',
    brief: 'Read src/copy.ts and report.',
    role: 'reviewer',
    mode,
    isolation: 'shared',
    baseCommit: null,
    provider: null,
    model: null,
  });
  const id = Object.keys(harness.state.runs).find((runId) => !before.has(runId)) ?? '';
  return findRun(harness, id);
}

function building() {
  const harness = createHarness();
  const taskId = createTask(harness);
  proposePlan(harness, taskId);
  return { harness, parent: harness.activeRun(taskId) };
}

function quietFor(harness: Harness, runId: string, minutes: number) {
  harness.send({ type: 'run.silence', runId, since: 0 });
  return resolveSilenceLevel(harness.state, findRun(harness, runId), minutes * MINUTE);
}

describe('resolveSilenceLevel', () => {
  test('is quiet at five minutes and critical at fifteen, from the last output', () => {
    const { harness, runId } = silentRun();
    const level = (now: number) => resolveSilenceLevel(harness.state, findRun(harness, runId), now);
    expect(level(0)).toBe('not_applicable');
    harness.send({ type: 'run.silence', runId, since: 0 });
    expect(level(4 * MINUTE)).toBe('ok');
    expect(level(5 * MINUTE)).toBe('suspicious');
    expect(level(15 * MINUTE)).toBe('critical');
    harness.send({ type: 'run.snooze_silence', runId, until: 30 * MINUTE });
    expect(level(20 * MINUTE)).toBe('snoozed');
    expect(level(31 * MINUTE)).toBe('critical');
    harness.send({ type: 'run.dismiss_silence', runId });
    expect(level(31 * MINUTE)).toBe('not_applicable');
  });

  test('does not apply while the agent waits on your answer, or once the run ended', () => {
    const { harness, taskId, runId } = silentRun();
    harness.send({ type: 'agent.ask', runId, gateId: 'q', question: 'Which?', context: null });
    expect(quietFor(harness, runId, 20)).toBe('not_applicable');
    harness.send({ type: 'task.cancel', taskId });
    const ended = findRun(harness, runId);
    expect(resolveSilenceLevel(harness.state, ended, 20 * MINUTE)).toBe('not_applicable');
    expect(resolveSilenceLevel(harness.state, { ...ended, endedAt: null, status: 'queued' }, 0)).toBe(
      'not_applicable'
    );
  });

  test('does not apply while a delegated agent waits for the answer to its question', () => {
    const { harness, parent } = building();
    const child = delegate(harness, parent.id, 'async');
    harness.send({
      type: 'agent.ask',
      runId: child.id,
      gateId: 'dq',
      question: 'Which file?',
      context: null,
    });
    expect(isRunWaiting(harness.state, findRun(harness, child.id))).toBe(true);
    expect(quietFor(harness, child.id, 20)).toBe('not_applicable');
  });

  test('does not apply while a step waits on the work it delegated, ended or blocking', () => {
    const blocked = building();
    delegate(blocked.harness, blocked.parent.id, 'wait');
    expect(quietFor(blocked.harness, blocked.parent.id, 20)).toBe('not_applicable');

    const ended = building();
    delegate(ended.harness, ended.parent.id, 'async');
    expect(isRunWaiting(ended.harness.state, findRun(ended.harness, ended.parent.id))).toBe(false);
    ended.harness.send({ type: 'run.end', runId: ended.parent.id, outcome: 'completed', summary: null });
    expect(findRun(ended.harness, ended.parent.id).status).toBe('waiting');
    expect(quietFor(ended.harness, ended.parent.id, 20)).toBe('not_applicable');
  });
});
