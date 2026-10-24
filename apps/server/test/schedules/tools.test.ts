import { afterEach, describe, expect, test } from 'bun:test';
import type { ShinsaCommand } from '@shinsa/core';
import { Schedules } from '../../src/schedules/index.ts';
import { createWorld, startTask, type World } from './fixtures.ts';

const NOW = Date.now();

const started: Schedules[] = [];

afterEach(() => {
  for (const schedules of started.splice(0)) schedules.stop();
});

function setUp(world: World) {
  const schedules = new Schedules(world.engine, world.secrets, {
    baseUrl: () => 'http://127.0.0.1:5180',
    timeZone: 'Europe/Berlin',
    now: () => NOW,
  });
  schedules.start();
  started.push(schedules);
  const call = {
    runId: world.runId,
    attemptId: 'a1',
    state: () => world.engine.state,
    dispatch: (command: Parameters<typeof world.engine.dispatch>[0]) => world.engine.dispatch(command),
  };
  const tool = (name: string, input: Record<string, unknown> = {}) => {
    const reply = schedules.handleTool(name, input, call);
    if (!reply) throw new Error(`${name} is not a schedule tool`);
    return reply;
  };
  return { schedules, call, tool };
}

function only(world: World) {
  const [schedule] = Object.values(world.engine.state.schedules);
  if (!schedule) throw new Error('no schedule');
  return schedule;
}

describe('set_schedule', () => {
  test('saves a daily schedule in the machine’s time zone and says when it runs next', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    const reply = await tool('set_schedule', {
      message: 'Check the build.',
      daily_at: '09:00',
      weekdays: [1, 2, 3, 4, 5],
    });
    const schedule = only(world);
    expect(schedule.timeZone).toBe('Europe/Berlin');
    expect(reply).toBe(
      `Saved “Check the build.” (schedule_id ${schedule.id}). Weekdays at 09:00 in Europe/Berlin. Next run ${new Date(schedule.nextRunAt ?? 0).toISOString()}. It messages this task.`
    );
  });

  test('a paused schedule for new tasks says so', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    const reply = await tool('set_schedule', {
      message: 'Audit.',
      every_minutes: 60,
      new_task: true,
      enabled: false,
      time_zone: 'UTC',
    });
    expect(reply).toContain('Every hour. Next run');
    expect(reply).toContain('It is paused. Starts a new task.');
  });

  test('a message into another task names it', async () => {
    const world = await createWorld();
    const other = await startTask(world.engine, world.repoId, world.dir, 'Another task');
    const { tool } = setUp(world);
    const reply = await tool('set_schedule', { message: 'Nudge.', every_minutes: 30, task_id: other.taskId });
    expect(reply).toContain('Messages “Another task”.');
  });

  test('a webhook gets a URL, and its signing secret comes from a one-use ref', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    const ref = world.secrets.writeRef('gate-1', world.taskId, 'shh');
    const reply = await tool('set_schedule', {
      message: 'A push: {{body.ref}}',
      webhook: { signature: { header: 'X-Hub-Signature-256', prefix: 'sha256=', secret_ref: ref } },
    });
    const schedule = only(world);
    const hook = world.secrets.selectHook(schedule.id);
    expect(hook?.secret).toBe('shh');
    expect(reply).toContain(`Its URL is http://127.0.0.1:5180/api/hooks/${schedule.id}/${hook?.token}.`);
    expect(reply).toContain('Requests must carry a valid x-hub-signature-256 signature.');
    expect(reply).not.toContain('shh');
    expect(() => world.secrets.removeRef(ref, world.taskId)).toThrow('has been used');
  });

  test('a signature check without a secret is refused until a ref is given', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    const signed = { webhook: { signature: { header: 'x-sig' } }, message: 'Hook' };
    await expect(tool('set_schedule', signed)).rejects.toThrow('request_secret');
    expect(world.engine.state.schedules).toEqual({});
  });

  test('a used ref still saves the schedule and says how to set the secret', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    const reply = await tool('set_schedule', {
      message: 'Hook',
      webhook: { signature: { header: 'x-sig', secret_ref: `secret-ref:${'0'.repeat(32)}` } },
    });
    const schedule = only(world);
    expect(reply).toContain('The schedule was saved, but its signing secret was not:');
    expect(reply).toContain(`set_schedule with schedule_id ${schedule.id}`);
  });

  test('a repeat of the same set_schedule call with its spent ref is answered as the first was', async () => {
    const world = await createWorld();
    const { schedules, call } = setUp(world);
    const repeated = {
      ...call,
      dispatch: (command: ShinsaCommand) => world.engine.dispatch(command, { id: 'mcp:7' }),
    };
    const ref = world.secrets.writeRef('gate-1', world.taskId, 'shh');
    const input = { message: 'Hook', webhook: { signature: { header: 'x-sig', secret_ref: ref } } };
    const first = await schedules.handleTool('set_schedule', input, repeated);
    const again = await schedules.handleTool('set_schedule', input, repeated);
    expect(again).toBe(first ?? '');
    expect(again).not.toContain('was not');
    expect(world.secrets.selectHook(only(world).id)?.secret).toBe('shh');
  });

  test('changing a signed webhook keeps its secret without a new ref', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    const ref = world.secrets.writeRef('gate-1', world.taskId, 'shh');
    await tool('set_schedule', {
      message: 'Hook',
      webhook: { signature: { header: 'x-sig', secret_ref: ref } },
    });
    const id = only(world).id;
    const reply = await tool('set_schedule', {
      schedule_id: id,
      name: 'Renamed hook',
      webhook: { signature: { header: 'x-sig' } },
    });
    expect(reply).toContain('Saved “Renamed hook”');
    expect(world.secrets.selectHook(id)?.secret).toBe('shh');
  });

  test('an edit that does not restate the time zone keeps the schedule’s own zone', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    await tool('set_schedule', { message: 'Standup', daily_at: '09:00', time_zone: 'Asia/Tokyo' });
    const id = only(world).id;
    const reply = await tool('set_schedule', { schedule_id: id, name: 'Morning standup' });
    expect(only(world).timeZone).toBe('Asia/Tokyo');
    expect(reply).toContain('Every day at 09:00 in Asia/Tokyo');
  });

  test('a change that changes nothing describes the schedule as it is', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    await tool('set_schedule', { message: 'Ping', in_minutes: 30 });
    const id = only(world).id;
    expect(await tool('set_schedule', { schedule_id: id })).toContain(`(schedule_id ${id}). Once.`);
  });

  test('refuses a broken request with every problem, and a run that is gone', async () => {
    const world = await createWorld();
    const { schedules, call } = setUp(world);
    await expect(
      schedules.handleTool('set_schedule', { in_minutes: 1, every_minutes: 1 }, call)
    ).rejects.toThrow('not several');
    await expect(
      schedules.handleTool('set_schedule', { in_minutes: 1 }, { ...call, runId: 'gone' })
    ).rejects.toThrow('This run no longer exists');
  });

  test('reports a schedule that a write did not save', async () => {
    const world = await createWorld();
    const { schedules, call } = setUp(world);
    const reply = schedules.handleTool(
      'set_schedule',
      { message: 'x', in_minutes: 5 },
      {
        ...call,
        dispatch: () => Promise.resolve([]),
      }
    );
    await expect(reply).rejects.toThrow('Nothing was saved.');
  });
});

describe('list_schedules and delete_schedule', () => {
  test('lists every schedule with its last runs, and the URL only of this task’s webhooks', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    await tool('set_schedule', { message: 'Hook', webhook: true });
    const hook = only(world);
    await world.engine.dispatch({
      type: 'schedule.deliver',
      scheduleId: hook.id,
      deliveryId: 'd1',
      text: 'Go',
      replayKey: null,
    });
    await world.engine.dispatch({
      type: 'schedule.fail',
      scheduleId: hook.id,
      dueAt: null,
      deliveryId: 'd2',
      detail: 'No.',
    });
    const listed = JSON.parse(await tool('list_schedules'));
    expect(listed.now).toBe(new Date(NOW).toISOString());
    expect(listed.schedules[0]).toMatchObject({
      schedule_id: hook.id,
      when: 'When its webhook is called',
      yours: true,
      url: expect.stringContaining(`/api/hooks/${hook.id}/`),
      last_runs: [
        { outcome: 'sent', task_id: world.taskId },
        { outcome: 'failed', detail: 'No.' },
      ],
    });
    const other = await startTask(world.engine, world.repoId, world.dir, 'Another task');
    const { schedules, call } = setUp(world);
    const theirs = JSON.parse(
      (await schedules.handleTool('list_schedules', {}, { ...call, runId: other.runId })) ?? ''
    );
    expect(theirs.schedules[0].yours).toBe(false);
    expect(theirs.schedules[0].url).toBeUndefined();
  });

  test('deletes a schedule and forgets its webhook credentials', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    await tool('set_schedule', { message: 'Hook', name: 'The hook', webhook: true });
    const id = only(world).id;
    expect(await tool('delete_schedule', { schedule_id: id })).toBe('Deleted “The hook”.');
    expect(world.secrets.selectHook(id)).toBeNull();
    await expect(tool('delete_schedule', {})).rejects.toThrow('schedule_id is required.');
  });

  test('other tools are not schedule tools', async () => {
    const world = await createWorld();
    const { schedules, call } = setUp(world);
    expect(schedules.handleTool('ask', {}, call)).toBeNull();
  });
});
