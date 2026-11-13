import { afterEach, describe, expect, test } from 'bun:test';
import { createState } from '@shinsa/core';
import { EngineStopped } from '../../src/runtime/engine/schema.ts';
import { AutopilotClock } from '../../src/runtime/index.ts';
import { createGate, createTask } from '../helpers/state.ts';
import { createFakeEngineCore, openClock } from './harness.ts';

const open: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

function createFakeEngine(answer: 'nothing' | 'failure') {
  const state = createState();
  state.tasks['task-1'] = createTask({ stage: 'awaiting_merge' });
  const merge = { type: 'merge' as const, taskId: 'task-1' };
  state.gates['g-due'] = createGate({
    ...merge,
    id: 'g-due',
    autopilotDue: { at: 1_000 },
  });
  state.gates['g-later'] = createGate({
    ...merge,
    id: 'g-later',
    autopilotDue: { at: 9_000 },
  });
  state.gates['g-none'] = createGate({ ...merge, id: 'g-none', autopilotDue: null });
  state.gates['g-answered'] = createGate({
    ...merge,
    id: 'g-answered',
    status: 'answered',
    autopilotDue: { at: 1_000 },
  });
  state.gates['g-review'] = createGate({
    type: 'review',
    id: 'g-review',
    autopilotDue: { at: 1_000 },
  });
  return createFakeEngineCore(state, () =>
    answer === 'failure' ? new EngineStopped({ message: 'log full' }) : []
  );
}

async function openAutopilot(fake: ReturnType<typeof createFakeEngine>) {
  const clock = await openClock(AutopilotClock, AutopilotClock.layer, fake.core, { now: 5_000 });
  open.push(clock);
  return clock;
}

describe('the Autopilot clock', () => {
  test('fires each open merge gate whose deadline passed, keyed by the gate and its deadline', async () => {
    const fake = createFakeEngine('nothing');
    await (await openAutopilot(fake)).fireDue();
    expect(fake.sent).toEqual([
      {
        command: { type: 'autopilot.fire', taskId: 'task-1', gateId: 'g-due', dueAt: 1_000 },
        id: 'autopilot:g-due:1000',
      },
    ]);
  });

  test('a fire answered with no events is not sent again, and one that fails is', async () => {
    const quiet = createFakeEngine('nothing');
    const once = await openAutopilot(quiet);
    await once.fireDue();
    await once.fireDue();
    expect(quiet.sent).toHaveLength(1);
    const failing = createFakeEngine('failure');
    const retried = await openAutopilot(failing);
    await retried.fireDue();
    await retried.fireDue();
    expect(failing.sent).toHaveLength(2);
  });
});
