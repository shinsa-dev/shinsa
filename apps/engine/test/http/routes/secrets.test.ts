import { afterEach, describe, expect, test } from 'bun:test';
import { listActiveRuns } from '@shinsa/core';
import { Schedules } from '../../../src/schedules/index.ts';
import { disposeWebHandlers } from '../../helpers/web.ts';
import { addSchedule, createWorld, type World } from '../../schedules/fixtures.ts';
import { readFailure, startRoutes } from './harness.ts';

const running: Schedules[] = [];

afterEach(async () => {
  for (const schedules of running.splice(0)) schedules.stop();
  await disposeWebHandlers();
});

function setUp(world: World, hookUrl?: (scheduleId: string, token: string) => string | null) {
  const schedules = new Schedules(world.engine, world.secrets, {
    baseUrl: () => 'http://127.0.0.1:5180',
    ...(hookUrl ? { hookUrl } : {}),
  });
  schedules.start();
  running.push(schedules);
  const routes = startRoutes({ engine: world.engine, schedules });
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const response = await routes.send(path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    if (!response.ok) {
      const failure = await readFailure(response);
      throw Object.assign(new Error(failure.message), failure);
    }
    return (await response.json()) as Record<string, unknown>;
  };
  return { call };
}

async function askForSecret(world: World) {
  const runId = listActiveRuns(world.engine.state, world.taskId)[0]?.id ?? '';
  await world.engine.dispatch({
    type: 'agent.request_secret',
    runId,
    gateId: 'gate-1',
    label: 'Signing secret',
    reason: 'Paste the secret GitHub shows for the webhook.',
  });
}

describe('webhook settings over HTTP', () => {
  test('shows the stable app.shinsa.dev URL while remote access is on', async () => {
    const world = await createWorld();
    const schedule = await addSchedule(world, { kind: 'webhook', signature: null, replayKey: null });
    const { call } = setUp(world, (id, hook) => `https://app.shinsa.dev/hooks/k3x9/${id}/${hook}`);
    const shown = await call('GET', `/api/schedules/${schedule.id}/webhook`);
    const token = world.secrets.selectHook(schedule.id)?.token;
    expect(shown.url).toBe(`https://app.shinsa.dev/hooks/k3x9/${schedule.id}/${token}`);
  });

  test('shows the URL and whether a secret is set, and sets or clears it', async () => {
    const world = await createWorld();
    const schedule = await addSchedule(world, {
      kind: 'webhook',
      signature: { header: 'x-sig', encoding: 'hex', prefix: '' },
      replayKey: null,
    });
    const { call } = setUp(world);
    expect(await call('GET', `/api/schedules/${schedule.id}/webhook`)).toEqual({
      url: `http://127.0.0.1:5180/api/hooks/${schedule.id}/${world.secrets.selectHook(schedule.id)?.token}`,
      signature: { header: 'x-sig', encoding: 'hex', prefix: '' },
      hasSecret: false,
      replayKey: null,
    });
    const set = await call('POST', `/api/schedules/${schedule.id}/webhook`, { secret: 'shh' });
    expect(set.hasSecret).toBe(true);
    expect(JSON.stringify(set)).not.toContain('shh');
    const cleared = await call('POST', `/api/schedules/${schedule.id}/webhook`, { secret: null });
    expect(cleared.hasSecret).toBe(false);
  });

  test('refuses a schedule without a webhook, an empty secret and a body that is not an object', async () => {
    const world = await createWorld();
    const timed = await addSchedule(world, { kind: 'interval', everyMinutes: 5 });
    const hook = await addSchedule(world, { kind: 'webhook', signature: null, replayKey: null });
    const { call } = setUp(world);
    await expect(call('GET', `/api/schedules/${timed.id}/webhook`)).rejects.toMatchObject({
      code: 'schedule_not_found',
      message: 'This schedule has no webhook.',
    });
    await expect(call('POST', `/api/schedules/${hook.id}/webhook`, { secret: '' })).rejects.toMatchObject({
      code: 'secret_invalid',
    });
    await expect(call('POST', `/api/schedules/${hook.id}/webhook`, '[1]')).rejects.toMatchObject({
      message: 'The request body must be an object.',
    });
    await expect(call('POST', `/api/schedules/${hook.id}/webhook`, '{x')).rejects.toMatchObject({
      message: 'The request body is not valid JSON.',
    });
  });

  test('a webhook whose hook is gone is not found', async () => {
    const world = await createWorld();
    const schedule = await addSchedule(world, { kind: 'webhook', signature: null, replayKey: null });
    const { call } = setUp(world);
    world.secrets.pruneHooks(new Set());
    await expect(call('GET', `/api/schedules/${schedule.id}/webhook`)).rejects.toMatchObject({
      code: 'schedule_not_found',
    });
  });

  test('without schedules the routes are not found', async () => {
    const routes = startRoutes();
    expect((await routes.send('/api/schedules/x/webhook')).status).toBe(404);
    expect((await routes.post('/api/secrets/gate-1', { value: 'x' })).status).toBe(404);
  });
});

describe('answering a secret request over HTTP', () => {
  test('stores the value and answers the question with a one-use ref', async () => {
    const world = await createWorld();
    await askForSecret(world);
    const { call } = setUp(world);
    expect(await call('POST', '/api/secrets/gate-1', { value: 'hunter2' })).toEqual({ ok: true });
    const gate = world.engine.state.gates['gate-1'];
    expect(gate?.status).toBe('answered');
    expect(gate?.response).toBe(world.secrets.resolveRef('gate-1'));
    expect(JSON.stringify(world.engine.state)).not.toContain('hunter2');
    expect(world.secrets.removeRef(gate?.response ?? '', world.taskId)).toBe('hunter2');
  });

  test('a decline answers without a value', async () => {
    const world = await createWorld();
    await askForSecret(world);
    const { call } = setUp(world);
    expect(await call('POST', '/api/secrets/gate-1', { decline: true })).toEqual({ ok: true });
    expect(world.engine.state.gates['gate-1']).toMatchObject({
      status: 'answered',
      decision: 'reject',
      response: null,
    });
  });

  test('refuses a question that is not a secret request or is already answered, and keeps nothing', async () => {
    const world = await createWorld();
    await askForSecret(world);
    const { call } = setUp(world);
    await expect(call('POST', '/api/secrets/nope', { value: 'x' })).rejects.toMatchObject({
      message: 'No secret was asked for here.',
    });
    await expect(call('POST', '/api/secrets/gate-1', { value: 'x'.repeat(10_001) })).rejects.toMatchObject({
      message: 'Paste the secret: 1 to 10000 characters.',
    });
    await call('POST', '/api/secrets/gate-1', { decline: true });
    await expect(call('POST', '/api/secrets/gate-1', { value: 'late' })).rejects.toMatchObject({
      message: 'This has already been answered.',
    });
  });

  test('a value whose answer the log refuses is thrown away', async () => {
    const world = await createWorld();
    await askForSecret(world);
    const { call } = setUp(world);
    world.engine.dispatch = () => Promise.reject(new Error('disk full'));
    await expect(call('POST', '/api/secrets/gate-1', { value: 'hunter2' })).rejects.toMatchObject({
      message: 'disk full',
    });
    expect(() => world.secrets.removeRef(world.secrets.resolveRef('gate-1'), world.taskId)).toThrow(
      'has been used'
    );
  });
});
