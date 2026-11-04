import { afterEach, describe, expect, test } from 'bun:test';
import { createState } from '@shinsa/core';
import { EngineStopped } from '../../src/runtime/engine/schema.ts';
import { AutoShipClock } from '../../src/runtime/index.ts';
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
    autoShipDue: { at: 1_000, action: 'escalate' },
  });
  state.gates['g-later'] = createGate({
    ...merge,
    id: 'g-later',
    autoShipDue: { at: 9_000, action: 'merge' },
  });
  state.gates['g-none'] = createGate({ ...merge, id: 'g-none', autoShipDue: null });
  state.gates['g-answered'] = createGate({
    ...merge,
    id: 'g-answered',
    status: 'answered',
    autoShipDue: { at: 1_000, action: 'merge' },
  });
  state.gates['g-review'] = createGate({
    type: 'review',
    id: 'g-review',
    autoShipDue: { at: 1_000, action: 'merge' },
  });
  return createFakeEngineCore(state, () =>
    answer === 'failure' ? new EngineStopped({ message: 'log full' }) : []
  );
}

async function openAutoShip(fake: ReturnType<typeof createFakeEngine>) {
  const clock = await openClock(AutoShipClock, AutoShipClock.layer, fake.core, { now: 5_000 });
  open.push(clock);
  return clock;
}

describe('the Auto-ship clock', () => {
  test('fires each open merge gate whose deadline passed, keyed by the gate and its deadline', async () => {
    const fake = createFakeEngine('nothing');
    await (await openAutoShip(fake)).fireDue();
    expect(fake.sent).toEqual([
      {
        command: { type: 'auto_ship.fire', taskId: 'task-1', gateId: 'g-due', dueAt: 1_000 },
        id: 'auto_ship:g-due:1000',
      },
    ]);
  });

  test('a fire answered with no events is not sent again, and one that fails is', async () => {
    const quiet = createFakeEngine('nothing');
    const once = await openAutoShip(quiet);
    await once.fireDue();
    await once.fireDue();
    expect(quiet.sent).toHaveLength(1);
    const failing = createFakeEngine('failure');
    const retried = await openAutoShip(failing);
    await retried.fireDue();
    await retried.fireDue();
    expect(failing.sent).toHaveLength(2);
  });
});
