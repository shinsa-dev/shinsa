import { describe, expect, test } from 'bun:test';
import { createHarness, createTask, linkSession, proposePlan } from '../harness.ts';

function ended() {
  const harness = createHarness();
  const taskId = createTask(harness);
  linkSession(harness, taskId, 'session-1');
  const runId = harness.activeRun(taskId).id;
  proposePlan(harness, taskId);
  return { harness, taskId, runId };
}

describe('recording an idle compaction', () => {
  test('marks the session compacted once', () => {
    const { harness, runId } = ended();
    harness.send({ type: 'run.compact', runId, sessionId: 'session-1' });
    expect(harness.state.runs[runId]?.compactions).toEqual(['session-1']);
    expect(harness.send({ type: 'run.compact', runId, sessionId: 'session-1' }).events).toHaveLength(0);
  });

  test('ignores a run still working, another session and a run that does not exist', () => {
    const { harness, taskId, runId } = ended();
    const builder = harness.activeRun(taskId).id;
    expect(harness.send({ type: 'run.compact', runId: builder, sessionId: 'x' }).events).toHaveLength(0);
    expect(harness.send({ type: 'run.compact', runId, sessionId: 'other' }).events).toHaveLength(0);
    expect(harness.send({ type: 'run.compact', runId: 'nope', sessionId: 'x' }).events).toHaveLength(0);
  });
});
