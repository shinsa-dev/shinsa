import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { listActiveRuns } from '@shinsa/core';
import { DomainError } from '@shinsa/core';
import { OWNER_ONLY_MESSAGE } from '@shinsa/core';
import { Effect, Layer } from 'effect';
import { GitHubProcess } from '../../../src/github/process/service.ts';
import { GitHubCli } from '../../../src/github/service.ts';
import { createTempDir } from '../../helpers/index.ts';
import { openTestSecrets } from '../../helpers/secrets.ts';
import { disposeWebHandlers } from '../../helpers/web.ts';
import { addSchedule, createWorld, type World } from '../../schedules/fixtures.ts';
import { openSchedules, type SchedulesHarness } from '../../schedules/harness.ts';
import { readFailure, startRoutes } from './harness.ts';

const running: SchedulesHarness[] = [];

afterEach(async () => {
  for (const harness of running.splice(0)) await harness.close();
  await disposeWebHandlers();
});

async function setUp(world: World, hookUrl?: (scheduleId: string, token: string) => string | null) {
  const harness = await openSchedules(world.engine.core, world.secrets.store, hookUrl ? { hookUrl } : {});
  await harness.start();
  running.push(harness);
  const routes = startRoutes({
    engine: world.engine,
    schedules: harness.schedules,
    secrets: world.secrets.store,
  });
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
    const { call } = await setUp(world, (id, hook) => `https://app.shinsa.dev/hooks/k3x9/${id}/${hook}`);
    const shown = await call('GET', `/api/schedules/${schedule.id}/webhook`);
    const token = (await world.secrets.selectHook(schedule.id))?.token;
    expect(shown.url).toBe(`https://app.shinsa.dev/hooks/k3x9/${schedule.id}/${token}`);
  });

  test('shows the URL and whether a secret is set, and sets or clears it', async () => {
    const world = await createWorld();
    const schedule = await addSchedule(world, {
      kind: 'webhook',
      signature: { header: 'x-sig', encoding: 'hex', prefix: '' },
      replayKey: null,
    });
    const { call } = await setUp(world);
    expect(await call('GET', `/api/schedules/${schedule.id}/webhook`)).toEqual({
      url: `http://127.0.0.1:5180/api/hooks/${schedule.id}/${(await world.secrets.selectHook(schedule.id))?.token}`,
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
    const { call } = await setUp(world);
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

  test('a webhook whose token is not written yet gets one at once', async () => {
    const world = await createWorld();
    const schedule = await addSchedule(world, { kind: 'webhook', signature: null, replayKey: null });
    const { call } = await setUp(world);
    await world.secrets.pruneHooks(new Set());
    const shown = (await call('GET', `/api/schedules/${schedule.id}/webhook`)) as { url: string };
    const hook = await world.secrets.selectHook(schedule.id);
    expect(shown.url).toEndWith(`/${schedule.id}/${hook?.token}`);
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
    const { call } = await setUp(world);
    expect(await call('POST', '/api/secrets/gate-1', { value: 'hunter2' })).toEqual({ ok: true });
    const gate = world.engine.state.gates['gate-1'];
    expect(gate?.status).toBe('answered');
    expect(gate?.response).toBe(await world.secrets.resolveRef('gate-1'));
    expect(JSON.stringify(world.engine.state)).not.toContain('hunter2');
    expect(await world.secrets.removeRef(gate?.response ?? '', world.taskId)).toBe('hunter2');
  });

  test('a decline answers without a value', async () => {
    const world = await createWorld();
    await askForSecret(world);
    const { call } = await setUp(world);
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
    const { call } = await setUp(world);
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
    const { call } = await setUp(world);
    Object.assign(world.engine.core, {
      dispatch: () => Effect.fail(new DomainError({ code: 'disk_full', message: 'disk full' })),
    });
    await expect(call('POST', '/api/secrets/gate-1', { value: 'hunter2' })).rejects.toMatchObject({
      message: 'disk full',
    });
    await expect(
      world.secrets.removeRef(await world.secrets.resolveRef('gate-1'), world.taskId)
    ).rejects.toThrow('has been used');
  });
});

describe('a member’s GitHub token over HTTP', () => {
  const KAI = { login: 'kai', name: 'Kai Lane', avatarUrl: null };
  const OWNER = { login: 'owner', name: 'Olive', avatarUrl: null };
  const remote = {
    isOwner: (userId: string | null) => Effect.succeed(userId === 'u-owner'),
    resolveActor: (userId: string | null) =>
      Effect.succeed(userId === null || userId === 'u-owner' ? OWNER : userId === 'u-kai' ? KAI : null),
    isEnabled: Effect.succeed(true),
  };

  async function setUpTokens(
    gh: (token: string | undefined) => { ok: boolean; stdout: string },
    extras = {}
  ) {
    const secrets = await openTestSecrets(join(createTempDir(), 'secrets.json'));
    const asked: string[] = [];
    const github = Effect.runSync(
      GitHubCli.use(Effect.succeed).pipe(
        Effect.provide(
          GitHubCli.layer.pipe(
            Layer.provide(
              GitHubProcess.layerTest((args) => {
                asked.push(args.join(' '));
                const { ok, stdout } = gh(undefined);
                return { ok, code: ok ? 0 : 1, stdout, stderr: ok ? '' : stdout, timedOut: false };
              })
            )
          )
        )
      )
    );
    const routes = startRoutes({ secrets: secrets.store, github, remote, ...extras } as never);
    const as = async (userId: string | null, method: 'GET' | 'POST', body?: unknown) => {
      const response = await routes.send(
        '/api/github-token',
        {
          method,
          headers: { 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        userId === null ? undefined : { via: 'channel', guest: null, userId }
      );
      if (!response.ok) return readFailure(response);
      return (await response.json()) as Record<string, unknown>;
    };
    return { routes, secrets, asked, as };
  }

  const kaiUser = () => ({ ok: true, stdout: JSON.stringify({ id: 7, login: 'kai', name: 'Kai Lane' }) });

  test('a member on a shared machine saves, reads and removes their own token', async () => {
    const { routes, secrets, asked, as } = await setUpTokens(kaiUser);
    await routes.context.engine.dispatch({ type: 'settings.change', patch: { sharedTeams: ['team-1'] } });
    expect(await as('u-kai', 'GET')).toEqual({
      login: 'kai',
      saved: false,
      savedAt: null,
      machineLogin: false,
    });
    expect(await as('u-kai', 'POST', { token: '  ghp_kai  ' })).toMatchObject({ login: 'kai', saved: true });
    expect(asked).toEqual(['api user']);
    expect(await secrets.selectGitHubToken('kai')).toMatchObject({
      token: 'ghp_kai',
      email: '7+kai@users.noreply.github.com',
    });
    expect(await as('u-kai', 'POST', { token: null })).toMatchObject({ saved: false });
    expect(await secrets.selectGitHubToken('kai')).toBeNull();
  });

  test('the machine’s owner uses its own login and has no token to save', async () => {
    const { routes, as } = await setUpTokens(kaiUser);
    await routes.context.engine.dispatch({ type: 'settings.change', patch: { sharedTeams: ['team-1'] } });
    expect(await as(null, 'GET')).toEqual({
      login: 'owner',
      saved: false,
      savedAt: null,
      machineLogin: true,
    });
    expect(await as('u-owner', 'POST', { token: 'ghp_x' })).toMatchObject({ code: 'github_token_machine' });
  });

  test('a token GitHub refuses, one of another account, or no token at all is not saved', async () => {
    const refused = await setUpTokens(() => ({ ok: false, stdout: 'Bad credentials' }));
    await refused.routes.context.engine.dispatch({
      type: 'settings.change',
      patch: { sharedTeams: ['team-1'] },
    });
    expect(await refused.as('u-kai', 'POST', { token: 'ghp_old' })).toMatchObject({
      code: 'github_token_refused',
    });
    expect(await refused.as('u-kai', 'POST', { token: '  ' })).toMatchObject({
      code: 'github_token_invalid',
    });
    expect(await refused.as('u-kai', 'POST', { token: 7 })).toMatchObject({ code: 'github_token_invalid' });
    const other = await setUpTokens(() => ({
      ok: true,
      stdout: JSON.stringify({ id: 9, login: 'mona', name: null }),
    }));
    await other.routes.context.engine.dispatch({
      type: 'settings.change',
      patch: { sharedTeams: ['team-1'] },
    });
    expect(await other.as('u-kai', 'POST', { token: 'ghp_mona' })).toMatchObject({
      code: 'github_token_other_account',
    });
    expect(await refused.secrets.selectGitHubToken('kai')).toBeNull();
    expect(await other.secrets.selectGitHubToken('kai')).toBeNull();
  });

  test('a member reaches it only on a shared machine, and a stranger never', async () => {
    const { routes, as } = await setUpTokens(kaiUser);
    expect(await as('u-kai', 'GET')).toMatchObject({ status: 403, message: OWNER_ONLY_MESSAGE });
    await routes.context.engine.dispatch({ type: 'settings.change', patch: { sharedTeams: ['team-1'] } });
    expect(await as('u-gone', 'GET')).toMatchObject({ status: 400, message: OWNER_ONLY_MESSAGE });
  });

  test('without remote access the token has no owner, and without a store the route is not served', async () => {
    const { as } = await setUpTokens(kaiUser, { remote: undefined });
    expect(await as(null, 'GET')).toMatchObject({ code: 'github_token_no_owner' });
    const noOwner = await setUpTokens(kaiUser, {
      remote: { ...remote, resolveActor: () => Effect.succeed(null) },
    });
    expect(await noOwner.as(null, 'GET')).toMatchObject({ code: 'github_token_no_owner' });
    const bare = startRoutes();
    expect((await bare.send('/api/github-token')).status).toBe(404);
    expect((await bare.post('/api/github-token', { token: 'x' })).status).toBe(404);
  });
});
