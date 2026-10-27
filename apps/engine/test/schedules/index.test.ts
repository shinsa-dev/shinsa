import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Schedules } from '../../src/schedules/index.ts';
import { SecretStore } from '../../src/secrets/index.ts';
import { addSchedule, createWorld } from './fixtures.ts';

describe('the schedules service', () => {
  test('on start it sweeps old refs and drops the credentials of schedules that are gone, and keeps doing so', async () => {
    const world = await createWorld();
    let now = 1_000;
    const secrets = new SecretStore(join(world.dir, 'swept.json'), { now: () => now });
    const old = secrets.writeRef('gate-old', world.taskId, 'old');
    now += 24 * 60 * 60 * 1000;
    const fresh = secrets.writeRef('gate-fresh', world.taskId, 'fresh');
    now += 2;
    const schedule = await addSchedule(world, { kind: 'webhook', signature: null, replayKey: null });
    secrets.upsertHook(schedule.id);
    secrets.upsertHook('gone');
    const schedules = new Schedules(world.engine, secrets, { baseUrl: () => 'http://x' });
    schedules.start();
    schedules.start();
    expect(secrets.hasRef(old)).toBe(false);
    expect(secrets.hasRef(fresh)).toBe(true);
    expect(secrets.selectHook('gone')).toBeNull();
    expect(secrets.selectHook(schedule.id)).not.toBeNull();
    await world.engine.dispatch({ type: 'schedule.remove', scheduleId: schedule.id });
    expect(secrets.selectHook(schedule.id)).toBeNull();
    schedules.stop();
    schedules.stop();
  });

  test('answers webhook paths and hands requests to its receiver', async () => {
    const world = await createWorld();
    const schedules = new Schedules(world.engine, world.secrets, {
      baseUrl: () => 'http://x',
      newId: () => 'd',
    });
    expect(schedules.isWebhook('/api/hooks/a/b')).toBe(true);
    expect(schedules.isWebhook('/api/tasks')).toBe(false);
    const response = await schedules.handleWebhook(
      new Request('http://x/api/hooks/a/b', { method: 'POST' }),
      new URL('http://x/api/hooks/a/b')
    );
    expect(response.status).toBe(404);
    expect(schedules.context.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
