import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountsSnapshot } from '@shinsa/core';
import { Cswap } from '../src/accounts/cswap.ts';
import type { ModelSource } from '../src/agents/index.ts';
import {
  type AgentProvider,
  type CompletionRequest,
  ProviderRegistry,
} from '../src/agents/providers/index.ts';
import { resolveConfig } from '../src/config/index.ts';
import { SIGN_IN_CALLBACK_PATH } from '../src/extensions/sign-in.ts';
import { inspectRepo } from '../src/git/index.ts';
import {
  createServerInstance,
  INSTALL_PATH,
  LOCK_FILE,
  resolveBootedAt,
  selectLockHolder,
} from '../src/instance/index.ts';
import { log } from '../src/log/index.ts';
import { EffectRunner, Engine } from '../src/runtime/index.ts';
import { type Shinsa, startShinsa } from '../src/serve.ts';
import { EventLog } from '../src/store/index.ts';
import { createGitRepo, createTempDir, createTestConfig, overrideEnv, until } from './helpers/index.ts';

setDefaultTimeout(30_000);

const started: Shinsa[] = [];

afterEach(async () => {
  for (const shinsa of started.splice(0)) await shinsa.stop();
});

const models = { listModels: () => Promise.resolve([]) } as unknown as ModelSource;

describe('startShinsa', () => {
  test('inspect mode serves the data of a running server beside it and refuses every command', async () => {
    const root = createTempDir();
    const live = await startShinsa(createTestConfig(root), {
      models,
      triage: () => Promise.resolve(null),
      resolveLogin: () => Promise.resolve(null),
    });
    started.push(live);
    await live.engine.dispatch({ type: 'task.create', request: 'Look only', repoId: null });
    const shinsa = await startShinsa(createTestConfig(root, { inspect: true }), { models });
    started.push(shinsa);
    expect(Object.values(shinsa.engine.state.tasks).map((task) => task.request)).toEqual(['Look only']);
    expect(await (await fetch(`${shinsa.url}/api/queue`)).json()).toMatchObject({ decisions: [] });
    const readOnly = {
      error: {
        code: 'inspect_read_only',
        message:
          'Shinsa is in inspect mode and only shows this data. Start it without SHINSA_INSPECT to change anything.',
      },
    };
    await expect(
      shinsa.engine.dispatch({ type: 'task.create', request: 'Another', repoId: null })
    ).rejects.toMatchObject({ code: 'inspect_read_only' });
    for (const path of [
      '/api/commands',
      '/api/accounts/login',
      '/api/onboarding/chat',
      '/api/schedules/s-1/webhook',
    ]) {
      const refused = await fetch(`${shinsa.url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: shinsa.url },
        body: JSON.stringify({ type: 'task.create', request: 'Another', repoId: null }),
      });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual(readOnly);
    }
    const webhook = await fetch(`${shinsa.url}/api/hooks/s-1`, { method: 'POST', body: '{}' });
    expect(webhook.status).toBe(403);
    expect(await webhook.json()).toEqual(readOnly);
    const callback = await fetch(`${shinsa.url}${SIGN_IN_CALLBACK_PATH}?state=s&code=c`);
    expect(callback.status).toBe(403);
    const socket = new WebSocket(`${shinsa.url.replace('http', 'ws')}/ws`, {
      headers: { origin: shinsa.url },
    });
    const acks: { type: string; id?: string; error?: { code: string } | null }[] = [];
    socket.addEventListener('message', (event) => acks.push(JSON.parse(String(event.data))));
    await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
    socket.send(
      JSON.stringify({ type: 'command', id: 'c-1', command: { type: 'task.cancel', taskId: 'x' } })
    );
    await until('the refusal', () => acks.some((message) => message.id === 'c-1'));
    expect(acks.find((message) => message.id === 'c-1')?.error?.code).toBe('inspect_read_only');
    socket.close();
    expect(Object.keys(shinsa.engine.state.tasks)).toHaveLength(1);
    expect(Object.keys(live.engine.state.tasks)).toHaveLength(1);
  });

  test('stopping aborts the running effects and pull request syncs and waits for them before closing the log', async () => {
    const shinsa = await startShinsa(createTestConfig(createTempDir(), { roots: [createTempDir()] }), {
      models,
      triage: () => Promise.resolve(null),
      resolveLogin: () => Promise.resolve(null),
    });
    const order: string[] = [];
    const { stop: stopSyncs } = EffectRunner.prototype;
    const { stop: stopEngine, settle } = Engine.prototype;
    const { close } = EventLog.prototype;
    const spies = [
      spyOn(EffectRunner.prototype, 'stop').mockImplementation(function (this: EffectRunner) {
        order.push('syncs stopped');
        return stopSyncs.call(this);
      }),
      spyOn(Engine.prototype, 'stop').mockImplementation(function (this: Engine) {
        order.push('effects aborted');
        stopEngine.call(this);
      }),
      spyOn(Engine.prototype, 'settle').mockImplementation(function (this: Engine) {
        order.push('effects settled');
        return settle.call(this);
      }),
      spyOn(EventLog.prototype, 'close').mockImplementation(function (this: EventLog) {
        order.push('log closed');
        close.call(this);
      }),
    ];
    try {
      await shinsa.stop();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(order).toEqual(['syncs stopped', 'effects aborted', 'effects settled', 'log closed']);
  });

  test('a task with nowhere to work stops at the "Could not start the task" gate', async () => {
    const config = createTestConfig(createTempDir(), { roots: [createTempDir()] });
    const shinsa = await startShinsa(config, {
      models,
      triage: () => Promise.resolve(null),
      resolveLogin: () => Promise.resolve(null),
      startSession: () => {
        throw new Error('no agents here');
      },
    });
    started.push(shinsa);
    await shinsa.engine.dispatch({ type: 'task.create', request: 'Do it', repoId: null });
    await until('a gate to open', () => Object.keys(shinsa.engine.state.gates).length > 0);
    expect(Object.values(shinsa.engine.state.gates)[0]?.title).toBe('Could not start the task');
  });

  test('work that needs a repository on a task triaged with none asks for one at the setup gate', async () => {
    const config = createTestConfig(createTempDir(), { roots: [createTempDir()] });
    const shinsa = await startShinsa(config, {
      models,
      triage: () =>
        Promise.resolve({ title: 'Fix it', repoPath: null, size: 'small', branch: 'fix/it', waitsOn: [] }),
      resolveLogin: () => Promise.resolve(null),
    });
    started.push(shinsa);
    await shinsa.engine.dispatch({ type: 'task.create', request: 'Fix it', repoId: null });
    await until('a gate to open', () => Object.keys(shinsa.engine.state.gates).length > 0);
    expect(Object.values(shinsa.engine.state.gates)[0]?.title).toBe('No repository for this task');
  });

  test('a broken config.json is kept aside once and its problem logged once, however often it is read', async () => {
    const home = createTempDir();
    writeFileSync(join(home, 'config.json'), '{ broken');
    const warn = spyOn(log, 'warn');
    try {
      const shinsa = await startShinsa(
        resolveConfig({ SHINSA_HOME: home, HOME: home, SHINSA_PORT: '0', SHINSA_INSPECT: '1' }),
        { models }
      );
      started.push(shinsa);
      expect(readdirSync(home).filter((name) => name.startsWith('config.json.unreadable-'))).toHaveLength(1);
      expect(
        warn.mock.calls.filter(([message]) => message === '[Config] Part of config.json was not used')
      ).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('serves on an IPv6 address under a URL with the address in brackets', async () => {
    const shinsa = await startShinsa(createTestConfig(createTempDir(), { inspect: true, hostname: '::1' }), {
      models,
    });
    started.push(shinsa);
    expect(new URL(shinsa.url).hostname).toBe('[::1]');
    expect((await fetch(`${shinsa.url}/api/health`)).status).toBe(200);
  });

  test('triage asks the server’s providers, on the classifier model chosen in Settings', async () => {
    const repo = await createGitRepo({ remote: false });
    const asked: CompletionRequest[] = [];
    const provider: AgentProvider = {
      id: 'claude',
      label: 'Claude',
      startSession: () => {
        throw new Error('no agents here');
      },
      complete: (request) => {
        asked.push(request);
        return Promise.resolve(
          '{"title":"Fix the injected title","repo":"app","size":{"choice":"small"},"branch":"fix/injected","waits_on":[]}'
        );
      },
      listModels: () => Promise.resolve([]),
    };
    const restore = overrideEnv({ SHINSA_QUICK: undefined });
    try {
      const shinsa = await startShinsa(createTestConfig(createTempDir(), { roots: [repo.root] }), {
        models,
        providers: new ProviderRegistry([provider]),
        resolveLogin: () => Promise.resolve(null),
        startSession: () => {
          throw new Error('no agents here');
        },
      });
      started.push(shinsa);
      await shinsa.engine.dispatch({
        type: 'settings.change',
        patch: { agentModels: { classifier: 'sonnet' } },
      });
      await shinsa.engine.dispatch({ type: 'task.create', request: 'Fix it', repoId: null });
      await until(
        'triage',
        () => Object.values(shinsa.engine.state.tasks)[0]?.title === 'Fix the injected title'
      );
      expect(asked.map((request) => request.model)).toEqual(['sonnet']);
    } finally {
      restore();
    }
  });

  test('a task agent manages Shinsa through the server it runs in', async () => {
    const repo = await createGitRepo({ remote: false });
    const replies: string[] = [];
    const shinsa = await startShinsa(createTestConfig(createTempDir(), { roots: [repo.root] }), {
      models,
      resolveLogin: () => Promise.resolve(null),
      startSession: (input) => {
        const signal = new AbortController().signal;
        const done = (async () => {
          replies.push(await input.tools.handle('tasks_list', { status: 'all' }, signal, 1));
          await input.tools.handle('answer', { answer: 'Listed them.' }, signal, 2);
          return { outcome: 'completed' as const, summary: null };
        })();
        return { done, steer: () => false, cancel: () => done.then(() => undefined) };
      },
    });
    started.push(shinsa);
    const candidate = await inspectRepo(repo.path);
    await shinsa.engine.dispatch({
      type: 'repo.register',
      repo: { ...candidate, checkCommands: [] },
      projectName: null,
    });
    const [repoId = ''] = Object.keys(shinsa.engine.state.repos);
    await shinsa.engine.dispatch({ type: 'task.create', request: 'What is open?', repoId, mode: 'ask' });
    await until('the agent to read the tasks', () => replies.length === 1);
    expect(replies[0]).toContain('What is open?');
  });

  test('the default model catalog is used when none is given', async () => {
    const shinsa = await startShinsa(createTestConfig(createTempDir(), { inspect: true }));
    started.push(shinsa);
    expect(shinsa.url.startsWith('http://127.0.0.1:')).toBe(true);
  });
});

describe('one Shinsa per data directory', () => {
  test('a second Shinsa on the same data folder is refused with the first one’s address, until it stops', async () => {
    const config = createTestConfig(createTempDir());
    const first = await startShinsa(config, { models });
    expect(selectLockHolder(config.dataDir)).toMatchObject({
      pid: process.pid,
      url: first.url,
      port: Number(new URL(first.url).port),
    });
    await expect(startShinsa(config, { models })).rejects.toThrow(
      `Shinsa is already running on ${config.dataDir}: ${first.url} (pid ${process.pid}`
    );
    await first.stop();
    expect(existsSync(join(config.dataDir, LOCK_FILE))).toBe(false);
    const second = await startShinsa(config, { models });
    started.push(second);
    expect(selectLockHolder(config.dataDir)?.url).toBe(second.url);
  });

  test('the lock a crashed Shinsa left behind is taken over', async () => {
    const config = createTestConfig(createTempDir());
    const crashed = Bun.spawn(['true']);
    await crashed.exited;
    writeFileSync(
      join(config.dataDir, LOCK_FILE),
      JSON.stringify({
        ...createServerInstance(null, 1),
        pid: crashed.pid,
        port: 5180,
        url: 'http://127.0.0.1:5180',
        bootedAt: resolveBootedAt(),
      })
    );
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      const shinsa = await startShinsa(config, { models });
      started.push(shinsa);
      expect(selectLockHolder(config.dataDir)).toMatchObject({ pid: process.pid, url: shinsa.url });
      expect(warn).toHaveBeenCalledWith('[Serve] Took over the lock a stopped Shinsa left behind', {
        path: join(config.dataDir, LOCK_FILE),
        pid: crashed.pid,
      });
    } finally {
      warn.mockRestore();
    }
  });

  test('a Shinsa that cannot listen gives the lock back', async () => {
    const taken = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('taken') });
    try {
      const config = createTestConfig(createTempDir(), { port: taken.port ?? 0 });
      await expect(startShinsa(config, { models })).rejects.toThrow();
      expect(existsSync(join(config.dataDir, LOCK_FILE))).toBe(false);
    } finally {
      await taken.stop(true);
    }
  });

  test('inspect mode takes no lock, so it reads the data of a Shinsa that is running', async () => {
    const config = createTestConfig(createTempDir());
    const live = await startShinsa(config, { models });
    started.push(live);
    const inspect = await startShinsa({ ...config, inspect: true }, { models });
    expect(selectLockHolder(config.dataDir)).toMatchObject({ pid: process.pid, url: live.url });
    await inspect.stop();
    expect(selectLockHolder(config.dataDir)?.url).toBe(live.url);
    const alone = createTestConfig(createTempDir(), { inspect: true });
    started.push(await startShinsa(alone, { models }));
    expect(existsSync(join(alone.dataDir, LOCK_FILE))).toBe(false);
  });

  test('health names the version, commit, install path, data folder, pid and uptime', async () => {
    const config = createTestConfig(createTempDir(), { inspect: true });
    const shinsa = await startShinsa(config, { models });
    started.push(shinsa);
    expect(await (await fetch(`${shinsa.url}/api/health`)).json()).toMatchObject({
      ok: true,
      version: '0.0.0',
      commit: expect.stringMatching(/^[0-9a-f]{40}$/),
      installPath: INSTALL_PATH,
      dataDir: config.dataDir,
      pid: process.pid,
      uptimeMs: expect.any(Number),
    });
  });
});

describe('startShinsa with Claude accounts', () => {
  test('serves the accounts and pushes them over the socket, even when checking them failed', async () => {
    const root = createTempDir();
    const config = createTestConfig(root, { roots: [createTempDir()] });
    const warn = spyOn(log, 'warn');
    const shinsa = await startShinsa(config, {
      models,
      triage: () => Promise.resolve(null),
      resolveLogin: () => Promise.resolve(null),
      accountOptions: {
        env: { CLAUDE_CONFIG_DIR: join(root, 'claude') },
        run: () =>
          Promise.resolve({ ok: false, code: 1, stdout: '{"loggedIn": false}', stderr: '', timedOut: false }),
        readSecret: () => Promise.resolve(null),
        cswap: new Cswap({ run: () => Promise.reject(new Error('cswap broke')), which: () => '/bin/cswap' }),
        resolveClaude: () => Promise.resolve('claude'),
      },
    });
    started.push(shinsa);
    await until('the failed check to be logged', () =>
      warn.mock.calls.some(([message]) => message === '[Serve] Could not check the Claude accounts')
    );
    warn.mockRestore();
    expect(await (await fetch(`${shinsa.url}/api/accounts`)).json()).toMatchObject({
      accounts: [],
      login: null,
      imports: [],
    });
    const socket = new WebSocket(`${shinsa.url.replace('http', 'ws')}/ws`, {
      headers: { origin: shinsa.url },
    });
    const messages: { type: string; accounts?: AccountsSnapshot }[] = [];
    socket.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))));
    await until('the accounts push with Codex’s sign-in', () =>
      messages.some((message) => message.type === 'accounts' && message.accounts?.providers?.length === 1)
    );
    const pushed = messages.filter((message) => message.type === 'accounts').at(-1)?.accounts;
    expect(pushed?.providers).toEqual([
      expect.objectContaining({ provider: 'codex', status: 'signed_in', method: 'ChatGPT' }),
    ]);
    const refused = await fetch(`${shinsa.url}/api/accounts/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: shinsa.url },
      body: JSON.stringify({ accountId: 'missing', patch: {} }),
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error: { code: 'account_not_found', message: 'That account is no longer in your accounts.' },
    });
    const acks: { type: string; id?: string; error?: { code: string } }[] = [];
    socket.addEventListener('message', (event) => acks.push(JSON.parse(String(event.data))));
    for (const [id, command] of [
      ['bind', { type: 'task.bind_account', taskId: 'missing', account: null }],
      ['change', { type: 'usage_wait.change', taskId: 'missing', autoResume: false }],
      ['resume', { type: 'usage_wait.resume_now', taskId: 'missing' }],
    ] as const) {
      socket.send(JSON.stringify({ type: 'command', id, command }));
    }
    await until('the three answers', () => acks.filter((message) => message.id).length >= 3);
    expect(acks.filter((message) => message.id).map((message) => message.error?.code)).toEqual([
      'task_not_found',
      'task_not_found',
      'task_not_found',
    ]);
    socket.close();
  });
});
