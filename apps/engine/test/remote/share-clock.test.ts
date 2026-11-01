import { describe, expect, test } from 'bun:test';
import { createState, type ShinsaCommand, type TaskShare } from '@shinsa/core';
import { ShareClock } from '../../src/remote/share-clock.ts';
import type { Engine } from '../../src/runtime/engine.ts';
import { createTask } from '../helpers/state.ts';

function createFakeEngine(shares: Record<string, TaskShare | null>, answer: 'events' | 'nothing') {
  const state = createState();
  for (const [id, share] of Object.entries(shares)) state.tasks[id] = createTask({ id, share });
  const sent: { command: ShinsaCommand; id: string | undefined }[] = [];
  const engine = {
    state,
    subscribe: () => () => undefined,
    dispatch: (command: ShinsaCommand, options: { id?: string } = {}) => {
      sent.push({ command, id: options.id });
      return Promise.resolve(answer === 'events' ? [{ type: 'task.unshared' }] : []);
    },
  };
  return { engine: engine as unknown as Engine, sent };
}

const SHARE = { at: 0, url: null, limit: 'hour', preset: 'standard', endsAt: 1_000 } as const;

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
    await new ShareClock(fake.engine, { now: () => 5_000 }).fireDue();
    expect(fake.sent).toEqual([{ command: { type: 'share.expire', taskId: 'due' }, id: 'share:due:1000' }]);
  });

  test('an end answered with no events is not sent again until the share changes', async () => {
    const fake = createFakeEngine({ due: SHARE }, 'nothing');
    const clock = new ShareClock(fake.engine, { now: () => 5_000 });
    await clock.fireDue();
    await clock.fireDue();
    expect(fake.sent).toHaveLength(1);
  });

  test('ends each preview whose time ran out, beside the task’s own share', async () => {
    const fake = createFakeEngine({ due: SHARE }, 'events');
    const task = fake.engine.state.tasks.due;
    if (task)
      task.previews = [
        { serviceId: 'web', at: 0, url: null, limit: 'hour', endsAt: 2_000 },
        { serviceId: 'api', at: 0, url: null, limit: 'none', endsAt: null },
        { serviceId: 'docs', at: 0, url: null, limit: 'week', endsAt: 9_000 },
      ];
    await new ShareClock(fake.engine, { now: () => 5_000 }).fireDue();
    expect(fake.sent).toEqual([
      { command: { type: 'share.expire', taskId: 'due' }, id: 'share:due:1000' },
      { command: { type: 'preview.expire', taskId: 'due', serviceId: 'web' }, id: 'preview:due:web:2000' },
    ]);
  });
});
