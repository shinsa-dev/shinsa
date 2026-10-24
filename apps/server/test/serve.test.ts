import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test';
import { readdirSync, writeFileSync } from 'node:fs';
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
import { inspectRepo } from '../src/git/index.ts';
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
  test('inspect mode serves the data without starting agents', async () => {
    const shinsa = await startShinsa(createTestConfig(createTempDir(), { inspect: true }), { models });
    started.push(shinsa);
    await shinsa.engine.dispatch({ type: 'task.create', request: 'Look only', repoId: null });
    await shinsa.engine.settle();
    expect(Object.values(shinsa.engine.state.tasks)[0]?.stage).toBe('triage');
    expect(await (await fetch(`${shinsa.url}/api/queue`)).json()).toMatchObject({ decisions: [] });
  });

  test('inspect mode lists the accounts but refuses to sign in, import or remove one', async () => {
    const config = createTestConfig(createTempDir(), { inspect: true });
    const shinsa = await startShinsa(config, { models });
    started.push(shinsa);
    expect((await fetch(`${shinsa.url}/api/accounts`)).status).toBe(200);
    for (const [path, body] of [
      ['login', {}],
      ['import', { origin: 'claude', email: 'me@example.com' }],
      ['remove', { accountId: 'acc-1' }],
    ] as const) {
      const refused = await fetch(`${shinsa.url}/api/accounts/${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: shinsa.url,
        },
        body: JSON.stringify(body),
      });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({
        error: {
          code: 'inspect_mode',
          message:
            'Shinsa is in inspect mode and only shows this data. Start it without SHINSA_INSPECT to sign in, refresh or change accounts.',
        },
      });
    }
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
