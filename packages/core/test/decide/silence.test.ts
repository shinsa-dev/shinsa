import { describe, expect, test } from 'bun:test';
import { createHarness, createTask } from '../harness.ts';

function silentRun() {
  const harness = createHarness();
  const taskId = createTask(harness);
  const run = harness.activeRun(taskId);
  return { harness, taskId, runId: run.id };
}

describe('the silent-run signal', () => {
  test('a run that went quiet is marked from its last output, and output clears it', () => {
    const { harness, runId } = silentRun();
    harness.send({ type: 'run.silence', runId, since: 500 });
    expect(harness.state.runs[runId]?.silence).toEqual({ since: 500, snoozedUntil: null, dismissed: false });
    expect(harness.send({ type: 'run.silence', runId, since: 500 }).events).toEqual([]);
    harness.send({ type: 'run.silence', runId, since: null });
    expect(harness.state.runs[runId]?.silence?.since).toBeNull();
  });

  test('is ignored for an ended or unknown run', () => {
    const { harness, taskId, runId } = silentRun();
    harness.send({ type: 'task.cancel', taskId });
    expect(harness.send({ type: 'run.silence', runId, since: 1 }).events).toEqual([]);
    expect(harness.send({ type: 'run.silence', runId: 'gone', since: 1 }).events).toEqual([]);
  });

  test('can be snoozed until a later time, and dismissed for good', () => {
    const { harness, runId } = silentRun();
    harness.send({ type: 'run.silence', runId, since: 1 });
    expect(() => harness.send({ type: 'run.snooze_silence', runId, until: 0 })).toThrow(
      'Snooze until a time in the future.'
    );
    harness.send({ type: 'run.snooze_silence', runId, until: 99_999 });
    expect(harness.send({ type: 'run.snooze_silence', runId, until: 99_999 }).events).toEqual([]);
    harness.send({ type: 'run.dismiss_silence', runId });
    expect(harness.send({ type: 'run.dismiss_silence', runId }).events).toEqual([]);
    expect(harness.state.runs[runId]?.silence).toMatchObject({ snoozedUntil: 99_999, dismissed: true });
    expect(() => harness.send({ type: 'run.dismiss_silence', runId: 'gone' })).toThrow('No run gone');
  });
});
