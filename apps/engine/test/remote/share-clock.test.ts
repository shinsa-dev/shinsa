import { afterEach, describe, expect, test } from 'bun:test';
import { createState, DomainError, SHARE_PRESET_SCOPES, type TaskShare } from '@shinsa/core';
import { ShareClock } from '../../src/remote/share-clock/service.ts';
import { EngineStopped } from '../../src/runtime/engine/schema.ts';
import { createTask } from '../helpers/state.ts';
import { createFakeEngineCore, openClock } from '../runtime/harness.ts';

const open: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

function createFakeEngine(
  shares: Record<string, TaskShare | null>,
  answer: 'events' | 'nothing' | 'refused' | 'broken'
) {
  const state = createState();
  for (const [id, share] of Object.entries(shares)) state.tasks[id] = createTask({ id, share });
  const fake = createFakeEngineCore(state, () => {
    if (answer === 'refused') return new DomainError({ code: 'share_not_found', message: 'Not shared.' });
    if (answer === 'broken') return new EngineStopped({ message: 'log closed' });
    return answer === 'events' ? [{ type: 'task.unshared' }] : [];
  });
  return { ...fake, state };
}

async function openShares(fake: ReturnType<typeof createFakeEngine>) {
  const clock = await openClock(ShareClock, ShareClock.layer, fake.core, { now: 5_000 });
  open.push(clock);
  return clock;
}

const SHARE = {
  at: 0,
  url: null,
  limit: 'hour',
  scopes: SHARE_PRESET_SCOPES.standard,
  endsAt: 1_000,
} as const;

describe('the share clock', () => {
  test('ends each share whose time ran out, and only those', async () => {
    const fake = createFakeEngine(
      {
        due: SHARE,
        later: { ...SHARE, endsAt: 9_000 },
        untilDone: { ...SHARE, limit: 'until_done', endsAt: null },
        unshared: null,
      },
      'events'
    );
    await (await openShares(fake)).fireDue();
    expect(fake.sent).toEqual([{ command: { type: 'share.expire', taskId: 'due' }, id: 'share:due:1000' }]);
  });

  test('an end answered with no events is not sent again until the share changes', async () => {
    const fake = createFakeEngine({ due: SHARE }, 'nothing');
    const clock = await openShares(fake);
    await clock.fireDue();
    await clock.fireDue();
    expect(fake.sent).toHaveLength(1);
  });

  test('ends each preview whose time ran out, beside the task’s own share', async () => {
    const fake = createFakeEngine({ due: SHARE }, 'events');
    const task = fake.state.tasks.due;
    if (task)
      task.previews = [
        { serviceId: 'web', at: 0, url: null, limit: 'hour', endsAt: 2_000 },
        { serviceId: 'api', at: 0, url: null, limit: 'none', endsAt: null },
        { serviceId: 'docs', at: 0, url: null, limit: 'week', endsAt: 9_000 },
      ];
    await (await openShares(fake)).fireDue();
    expect(fake.sent).toEqual([
      { command: { type: 'share.expire', taskId: 'due' }, id: 'share:due:1000' },
      { command: { type: 'preview.expire', taskId: 'due', serviceId: 'web' }, id: 'preview:due:web:2000' },
    ]);
  });

  test('an end core refuses is not sent again, and one that breaks is tried again', async () => {
    const refused = createFakeEngine({ due: SHARE }, 'refused');
    const clock = await openShares(refused);
    await clock.fireDue();
    await clock.fireDue();
    expect(refused.sent).toHaveLength(1);
    const broken = createFakeEngine({ due: SHARE }, 'broken');
    const retried = await openShares(broken);
    await retried.fireDue();
    await retried.fireDue();
    expect(broken.sent).toHaveLength(2);
  });
});
