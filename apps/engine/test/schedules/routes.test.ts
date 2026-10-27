import { afterEach, describe, expect, test } from 'bun:test';
import { listActiveRuns } from '@shinsa/core';
import { Schedules } from '../../src/schedules/index.ts';
import { addSchedule, createWorld, type World } from './fixtures.ts';

const running: Schedules[] = [];

afterEach(() => {
  for (const schedules of running.splice(0)) schedules.stop();
});

function setUp(world: World) {
  const schedules = new Schedules(world.engine, world.secrets, { baseUrl: () => 'http://127.0.0.1:5180' });
  schedules.start();
  running.push(schedules);
  const routes = schedules.routes();
  async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
    const route = routes.find((entry) => entry.method === method && entry.pattern.test(path));
    if (!route) throw new Error(`no route for ${method} ${path}`);
    const match = route.pattern.exec(path) as RegExpExecArray;
    const request = new Request(`http://127.0.0.1${path}`, {
      method,
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    return route.respond(match, request);
  }
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

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe('webhook settings', () => {
  test('shows the URL and whether a secret is set, and sets or clears it', async () => {
    const world = await createWorld();
    const schedule = await addSchedule(world, {
      kind: 'webhook',
      signature: { header: 'x-sig', encoding: 'hex', prefix: '' },
      replayKey: null,
    });
    const { call } = setUp(world);
    const shown = await readJson(await call('GET', `/api/schedules/${schedule.id}/webhook`));
    expect(shown).toEqual({
      url: `http://127.0.0.1:5180/api/hooks/${schedule.id}/${world.secrets.selectHook(schedule.id)?.token}`,
      signature: { header: 'x-sig', encoding: 'hex', prefix: '' },
      hasSecret: false,
      replayKey: null,
    });
    const set = await readJson(
      await call('POST', `/api/schedules/${schedule.id}/webhook`, { secret: 'shh' })
    );
    expect(set.hasSecret).toBe(true);
    expect(JSON.stringify(set)).not.toContain('shh');
    const cleared = await readJson(
      await call('POST', `/api/schedules/${schedule.id}/webhook`, { secret: null })
    );
    expect(cleared.hasSecret).toBe(false);
  });

  test('refuses a schedule without a webhook, an empty secret and a body that is not an object', async () => {
    const world = await createWorld();
    const timed = await addSchedule(world, { kind: 'interval', everyMinutes: 5 });
    const hook = await addSchedule(world, { kind: 'webhook', signature: null, replayKey: null });
    const { call } = setUp(world);
    await expect(call('GET', `/api/schedules/${timed.id}/webhook`)).rejects.toThrow(
      'This schedule has no webhook.'
    );
    await expect(call('POST', `/api/schedules/${hook.id}/webhook`, { secret: '' })).rejects.toThrow(
      'Paste the secret'
    );
    await expect(call('POST', `/api/schedules/${hook.id}/webhook`, '[1]')).rejects.toThrow(
      'must be an object'
    );
    await expect(call('POST', `/api/schedules/${hook.id}/webhook`, '{x')).rejects.toThrow('not valid JSON');
  });
});

describe('answering a secret request', () => {
  test('stores the value and answers the question with a one-use ref', async () => {
    const world = await createWorld();
    await askForSecret(world);
    const { call } = setUp(world);
    expect(await readJson(await call('POST', '/api/secrets/gate-1', { value: 'hunter2' }))).toEqual({
      ok: true,
    });
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
    await call('POST', '/api/secrets/gate-1', { decline: true });
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
    await expect(call('POST', '/api/secrets/nope', { value: 'x' })).rejects.toThrow(
      'No secret was asked for here.'
    );
    await expect(call('POST', '/api/secrets/gate-1', { value: 'x'.repeat(10_001) })).rejects.toThrow(
      'Paste the secret'
    );
    await call('POST', '/api/secrets/gate-1', { decline: true });
    await expect(call('POST', '/api/secrets/gate-1', { value: 'late' })).rejects.toThrow(
      'already been answered'
    );
  });

  test('a value whose answer the log refuses is thrown away', async () => {
    const world = await createWorld();
    await askForSecret(world);
    const { call } = setUp(world);
    world.engine.dispatch = () => Promise.reject(new Error('disk full'));
    await expect(call('POST', '/api/secrets/gate-1', { value: 'hunter2' })).rejects.toThrow('disk full');
    expect(() => world.secrets.removeRef(world.secrets.resolveRef('gate-1'), world.taskId)).toThrow(
      'has been used'
    );
  });
});
