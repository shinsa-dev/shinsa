import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Effect } from 'effect';
import { ScheduleTimeZone } from '../../src/schedules/schema.ts';
import { isWebhookPath } from '../../src/schedules/webhook/path.ts';
import { createTempDir } from '../helpers/index.ts';
import { openTestSecrets } from '../helpers/secrets.ts';
import { addSchedule, createWorld } from './fixtures.ts';
import { openSchedules, type SchedulesHarness } from './harness.ts';

const open: SchedulesHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

describe('the schedules service', () => {
  test('on start it sweeps old refs and drops the credentials of schedules that are gone, and keeps doing so', async () => {
    const world = await createWorld();
    const secrets = openTestSecrets(join(createTempDir(), 'secrets.json'));
    const old = secrets.writeRef('gate-old', world.taskId, 'old');
    await secrets.setTime(24 * 60 * 60 * 1000);
    const fresh = secrets.writeRef('gate-fresh', world.taskId, 'fresh');
    await secrets.setTime(24 * 60 * 60 * 1000 + 2);
    const schedule = await addSchedule(world, { kind: 'webhook', signature: null, replayKey: null });
    secrets.upsertHook(schedule.id);
    secrets.upsertHook('gone');
    const harness = await openSchedules(world.engine.core, secrets.store, { baseUrl: 'http://x' });
    open.push(harness);
    await world.engine.dispatch({ type: 'schedule.remove', scheduleId: schedule.id });
    expect(secrets.selectHook(schedule.id)).not.toBeNull();
    await harness.start();
    await harness.start();
    expect(secrets.hasRef(old)).toBe(false);
    expect(secrets.hasRef(fresh)).toBe(true);
    expect(secrets.selectHook('gone')).toBeNull();
    expect(secrets.selectHook(schedule.id)).toBeNull();
    const next = await addSchedule(world, { kind: 'webhook', signature: null, replayKey: null });
    expect(secrets.selectHook(next.id)).not.toBeNull();
    await world.engine.dispatch({ type: 'schedule.remove', scheduleId: next.id });
    expect(secrets.selectHook(next.id)).toBeNull();
    await harness.stop();
    await harness.stop();
    const after = await addSchedule(world, { kind: 'webhook', signature: null, replayKey: null });
    expect(secrets.selectHook(after.id)).toBeNull();
  });

  test('answers webhook paths and hands requests to its receiver', async () => {
    const world = await createWorld();
    const harness = await openSchedules(world.engine.core, world.secrets.store, { newId: () => 'd' });
    open.push(harness);
    expect(isWebhookPath('/api/hooks/a/b')).toBe(true);
    expect(isWebhookPath('/api/tasks')).toBe(false);
    const response = await harness.handleWebhook(
      new Request('http://x/api/hooks/a/b', { method: 'POST' }),
      new URL('http://x/api/hooks/a/b')
    );
    expect(response.status).toBe(404);
    expect(
      Effect.runSync(
        Effect.gen(function* () {
          return yield* ScheduleTimeZone;
        })
      )
    ).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
