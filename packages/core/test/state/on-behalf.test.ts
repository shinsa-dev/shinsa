import { describe, expect, test } from 'bun:test';
import {
  applyEvent,
  createState,
  ON_BEHALF_ACTION_LIMIT,
  replayEventLog,
  type ShinsaEvent,
} from '../../src/index.ts';
import { createHarness, createTask, reachReviewGate } from '../harness.ts';

function acted(seq: number): ShinsaEvent {
  return {
    type: 'on_behalf.acted',
    command: 'task.message',
    taskId: null,
    summary: `Action ${seq}`,
    onBehalf: true,
    seq,
    at: seq * 1_000,
  };
}

describe('what Shinsa did on the human’s behalf', () => {
  test('starts empty and keeps the newest actions up to the limit', () => {
    let state = createState();
    expect(state.onBehalfActions).toEqual([]);
    for (let seq = 1; seq <= ON_BEHALF_ACTION_LIMIT + 1; seq += 1) state = applyEvent(state, acted(seq));
    expect(state.onBehalfActions).toHaveLength(ON_BEHALF_ACTION_LIMIT);
    expect(state.onBehalfActions?.[0]?.summary).toBe('Action 2');
    expect(state.onBehalfActions?.at(-1)).toEqual({
      at: (ON_BEHALF_ACTION_LIMIT + 1) * 1_000,
      command: 'task.message',
      taskId: null,
      summary: `Action ${ON_BEHALF_ACTION_LIMIT + 1}`,
    });
  });

  test('replaying the log marks the same activity as done on the human’s behalf', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'Smaller, please.' }, { onBehalf: true });
    harness.send({ type: 'task.message', taskId, text: 'Thanks.' });
    const replayed = replayEventLog(harness.events).state;
    expect(replayed).toEqual(harness.state);
    const flagged = (replayed.tasks[taskId]?.activity ?? []).filter((entry) => entry.onBehalf);
    expect(flagged.map((entry) => [entry.actor, entry.detail])).toEqual([['you', 'Smaller, please.']]);
  });
});
