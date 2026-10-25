import { describe, expect, test } from 'bun:test';
import { decide, serializeRun, serializeState } from '../../src/index.ts';
import { buildAll, createHarness, createTask, failing } from '../harness.ts';

function reachFix() {
  const harness = createHarness();
  const taskId = createTask(harness);
  buildAll(harness, taskId);
  harness.send({ type: 'checks.record', taskId, results: failing() });
  return { harness, taskId };
}

describe('wire runs', () => {
  test('go without their prompts and with the focus of a fix', () => {
    const { harness, taskId } = reachFix();
    const run = harness.activeRun(taskId);
    expect(run.prompt).toBeString();
    const wire = serializeRun(run);
    expect(wire).not.toHaveProperty('prompt');
    expect(wire).not.toHaveProperty('rolePrompt');
    expect(wire).toMatchObject({ id: run.id, purpose: 'fix', fixFocus: 'checks' });
    expect(serializeRun(run)).toBe(wire);
  });

  test('leave a run without a focus when it is not a fix', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(serializeRun(harness.activeRun(taskId))).not.toHaveProperty('fixFocus');
  });

  test('keep a run that already has no prompt, and the focus it carries', () => {
    const { harness, taskId } = reachFix();
    const wire = serializeRun(harness.activeRun(taskId));
    expect(serializeRun(wire)).toBe(wire);
    const stopped = { ...wire, endedAt: 1 };
    expect(serializeRun(stopped)).toMatchObject({ fixFocus: 'checks', endedAt: 1 });
  });
});

describe('wire state', () => {
  test('holds every run without its prompts and keeps everything else', () => {
    const { harness } = reachFix();
    const wire = serializeState(harness.state);
    expect(wire.tasks).toBe(harness.state.tasks);
    expect(Object.keys(wire.runs)).toEqual(Object.keys(harness.state.runs));
    expect(JSON.stringify(wire)).not.toContain('"prompt"');
    expect(serializeState(harness.state).runs).toBe(wire.runs);
  });

  test('is the same state when no run has a prompt, so a page keeps its identities', () => {
    const { harness, taskId } = reachFix();
    const wire = serializeState(harness.state);
    expect(serializeState(wire)).toBe(wire);
    const decided = decide(
      wire,
      { type: 'task.prioritize', taskId, priority: 'urgent' },
      {
        now: harness.now,
        newId: () => 'unused',
      }
    ).state;
    const next = serializeState(decided);
    expect(next.runs).toBe(wire.runs);
    expect(next.tasks[taskId]?.priority).toBe('urgent');
  });
});
