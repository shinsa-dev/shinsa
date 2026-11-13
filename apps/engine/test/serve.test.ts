import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountsSnapshot } from '@shinsa/core';
import { Duration, Effect, Layer } from 'effect';
import { AccountsEnv, ClaudeCommandPath } from '../src/accounts/index.ts';
import { KeychainPlatform } from '../src/accounts/keychain/schema.ts';
import type { ModelSource } from '../src/agents/index.ts';
import { type AgentProvider, type CompletionRequest, Providers } from '../src/agents/providers/index.ts';
import { SIGN_IN_CALLBACK_PATH } from '../src/extensions/sign-in.ts';
import { createServerInstance, INSTALL_PATH, LOCK_FILE, resolveBootedAt } from '../src/instance/index.ts';
import { RelayConnectFailed, RelayConnector, REMOTE_FILE } from '../src/remote/index.ts';
import { Shell } from '../src/shell/service.ts';
import { resolveStateVersion } from '../src/store/index.ts';
import { TerminalPty } from '../src/terminals/pty/service.ts';
import { runFiles } from './harness.ts';
import { resolveConfig } from './helpers/config.ts';
import { openEventLog } from './helpers/event-log.ts';
import { inspectRepo } from './helpers/git.ts';
import {
  captureLogs,
  createGitRepo,
  createTempDir,
  createTestConfig,
  overrideEnv,
  until,
} from './helpers/index.ts';
import { selectLockHolder } from './helpers/lock.ts';
import { adaptStarter } from './helpers/providers.ts';
import { type Shinsa, startShinsa } from './helpers/serve.ts';

function spyOnLog(listeners: Record<string, () => unknown>) {
  const write = process.stdout.write.bind(process.stdout);
  return spyOn(process.stdout, 'write').mockImplementation((chunk: unknown, ...rest: unknown[]) => {
    for (const [message, listener] of Object.entries(listeners)) {
      if (String(chunk).includes(`"message":"${message}"`)) listener();
    }
    return write(chunk as string, ...(rest as []));
  });
}

setDefaultTimeout(30_000);

const started: Shinsa[] = [];

afterEach(async () => {
  for (const shinsa of started.splice(0)) await shinsa.stop();
});

const models = { listModels: Effect.succeed([]) } as unknown as ModelSource;

describe('startShinsa', () => {
  test('inspect mode serves the data of a running server beside it and refuses every command', async () => {
    const root = createTempDir();
    const live = await startShinsa(createTestConfig(root), {
      models,
      triage: () => Effect.succeed(null),
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
        message: 'Inspect mode is read-only.',
      },
    };
    await expect(
      shinsa.engine.dispatch({ type: 'task.create', request: 'Another', repoId: null })
    ).rejects.toMatchObject({ code: 'inspect_read_only' });
    for (const path of [
      '/api/commands',
      '/api/accounts/login',
      '/api/onboarding/flow',
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
      triage: () => Effect.succeed(null),
      resolveLogin: () => Promise.resolve(null),
    });
    const order: string[] = [];
    const spy = spyOnLog({
      '[Serve] Stopped the pull request syncs': () => order.push('syncs stopped'),
      '[Serve] Stopped the running effects': () => order.push('effects aborted'),
      '[Serve] Every running effect has settled': () => order.push('effects settled'),
      '[Serve] Closed the event log': () => order.push('log closed'),
    });
    try {
      await shinsa.stop();
    } finally {
      spy.mockRestore();
    }
    expect(order).toEqual(['syncs stopped', 'effects aborted', 'effects settled', 'log closed']);
  });

  test('a server keeps a snapshot of the state under this code’s version, and the next start replays only what follows it', async () => {
    const config = createTestConfig(createTempDir());
    const options = {
      models,
      triage: () => Effect.succeed(null),
      resolveLogin: () => Promise.resolve(null),
    };
    const first = await startShinsa(config, options);
    await first.engine.dispatch({ type: 'task.create', request: 'Keep me', repoId: null });
    await first.engine.dispatch({ type: 'focus.change', projectId: null, until: 1 });
    const seq = first.engine.state.seq;
    await first.stop();
    const reader = openEventLog(config.databasePath);
    expect(reader.selectSnapshot((await runFiles(resolveStateVersion())) ?? '')).toMatchObject({
      ok: true,
      seq,
    });
    reader.close();
    expect(seq).toBeGreaterThan(1);
    const db = new Database(config.databasePath);
    db.run('UPDATE events SET payload = \'{"type":"task.cre\' WHERE seq < ?', [seq]);
    db.close();
    const second = await startShinsa(config, options);
    started.push(second);
    expect(second.engine.problems).toEqual([]);
    expect(Object.values(second.engine.state.tasks).map((task) => task.request)).toEqual(['Keep me']);
  });

  test('a task with nowhere to work stops at the "Could not start the task" gate', async () => {
    const config = createTestConfig(createTempDir(), { roots: [createTempDir()] });
    const shinsa = await startShinsa(config, {
      models,
      triage: () => Effect.succeed(null),
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
        Effect.succeed({ title: 'Fix it', repoPath: null, size: 'small', branch: 'fix/it', waitsOn: [] }),
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
    const logs = captureLogs();
    try {
      const shinsa = await startShinsa(
        await resolveConfig({ SHINSA_HOME: home, HOME: home, SHINSA_PORT: '0', SHINSA_INSPECT: '1' }),
        { models }
      );
      started.push(shinsa);
      expect(readdirSync(home).filter((name) => name.startsWith('config.json.unreadable-'))).toHaveLength(1);
      expect(logs.fieldsOf('[Config] Part of config.json was not used')).toHaveLength(1);
    } finally {
      logs.restore();
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
        return Effect.succeed(
          '{"title":"Fix the injected title","repo":"app","size":{"choice":"small"},"branch":"fix/injected","waits_on":[]}'
        );
      },
      listModels: Effect.succeed([]),
    };
    const restore = overrideEnv({ SHINSA_QUICK: undefined });
    try {
      const shinsa = await startShinsa(createTestConfig(createTempDir(), { roots: [repo.root] }), {
        models,
        providers: Providers.make([provider]),
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
      startSession: adaptStarter((input) => {
        const signal = new AbortController().signal;
        const done = (async () => {
          replies.push(
            await Effect.runPromise(input.tools.handle('tasks_list', { status: 'all' }, signal, 1))
          );
          await Effect.runPromise(input.tools.handle('answer', { answer: 'Listed them.' }, signal, 2));
          return { outcome: 'completed' as const, summary: null };
        })();
        return { done, steer: () => false, cancel: () => done.then(() => undefined) };
      }),
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

  test('started by launchd, a restart stops Shinsa and exits with the restart code', async () => {
    const codes: number[] = [];
    const shinsa = await startShinsa(createTestConfig(createTempDir()), {
      models,
      triage: () => Effect.succeed(null),
      resolveLogin: () => Promise.resolve(null),
      byService: true,
      exit: (code) => codes.push(code),
    });
    const response = await fetch(`${shinsa.url}/api/engine/restart`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ when: 'now' }),
    });
    expect(await response.json()).toEqual({ restarting: true });
    await until('the restart to exit', () => codes.length === 1);
    expect(codes).toEqual([75]);
  });

  test('a paired machine starts its tunnel to the engine and gives webhooks their app.shinsa.dev URL', async () => {
    const root = createTempDir();
    const config = createTestConfig(root);
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(
      join(config.dataDir, REMOTE_FILE),
      JSON.stringify({
        version: 1,
        machine: null,
        owner: 'mona',
        enabled: true,
        devices: [],
        credentials: {
          instanceId: 'k3x9',
          machineToken: 'm',
          connectKey: 'c',
        },
      })
    );
    const localUrls: string[] = [];
    const shinsa = await startShinsa(config, {
      models,
      remoteConnector: Layer.succeed(RelayConnector, {
        open: (target) => {
          localUrls.push(target.localUrl);
          return Effect.fail(new RelayConnectFailed({ message: 'No relay in tests.', status: null }));
        },
      }),
    });
    started.push(shinsa);
    await until('the tunnel to start', () => localUrls.length > 0);
    expect(localUrls[0]).toBe(shinsa.url);
    const events = await shinsa.engine.dispatch({
      type: 'schedule.write',
      scheduleId: null,
      name: 'Alerts',
      text: 'Look at the alert.',
      trigger: { kind: 'webhook', signature: null, replayKey: null },
      target: { kind: 'new_task', repoId: null, priority: 'normal', mode: 'build' },
      source: null,
      enabled: null,
      maxRuns: null,
      timeZone: 'UTC',
    });
    const written = events.find((event) => event.type === 'schedule.written');
    if (written?.type !== 'schedule.written') throw new Error('no schedule');
    const webhook = await fetch(`${shinsa.url}/api/schedules/${written.schedule.id}/webhook`);
    expect(((await webhook.json()) as { url: string }).url).toStartWith(
      `${config.remoteOrigin}/hooks/k3x9/${written.schedule.id}/`
    );
    const mention = await fetch(`${shinsa.url}/api/slack/events`, {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.9', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(mention.status).toBe(401);
    expect(await mention.json()).toMatchObject({ error: { code: 'unauthorized' } });
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
    expect(await selectLockHolder(config.dataDir)).toMatchObject({
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
    expect((await selectLockHolder(config.dataDir))?.url).toBe(second.url);
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
        bootedAt: resolveBootedAt(Date.now()),
      })
    );
    const logs = captureLogs();
    try {
      const shinsa = await startShinsa(config, { models });
      started.push(shinsa);
      expect(await selectLockHolder(config.dataDir)).toMatchObject({ pid: process.pid, url: shinsa.url });
      expect(logs.fieldsOf('[Serve] Took over the lock a stopped Shinsa left behind')).toEqual([
        { path: join(config.dataDir, LOCK_FILE), pid: crashed.pid },
      ]);
    } finally {
      logs.restore();
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

  test('a Shinsa whose start fails after it listens stops what it started and gives the port and the lock back', async () => {
    const config = createTestConfig(createTempDir());
    const broken = new Error('recovery broke');
    let closed = 0;
    const spy = spyOnLog({
      '[Serve] Ready': () => {
        throw broken;
      },
      '[Serve] Closed the event log': () => {
        closed += 1;
      },
    });
    try {
      await expect(startShinsa(config, { models })).rejects.toBe(broken);
      expect(closed).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(existsSync(join(config.dataDir, LOCK_FILE))).toBe(false);
    const again = await startShinsa(config, { models });
    started.push(again);
    expect((await selectLockHolder(config.dataDir))?.url).toBe(again.url);
  });

  test('stopping releases the effects, then Eunoe, then the server, then the log, then the lock', async () => {
    const config = createTestConfig(createTempDir());
    const order: string[] = [];
    const serve = Bun.serve;
    const serving = spyOn(Bun, 'serve').mockImplementation(((options: Parameters<typeof Bun.serve>[0]) => {
      const server = serve(options);
      const stop = server.stop.bind(server);
      return Object.assign(server, {
        stop: (closeActive?: boolean) => {
          order.push('server stopped');
          return stop(closeActive);
        },
      });
    }) as typeof Bun.serve);
    const shinsa = await startShinsa(config, { models }).finally(() => serving.mockRestore());
    const isListening = () =>
      fetch(`${shinsa.url}/api/health`).then(
        () => true,
        () => false
      );
    const spy = spyOnLog({
      '[Serve] Every running effect has settled': () => order.push('effects settled'),
      '[Eunoe] Stopped the forwarder': () => order.push('eunoe stopped'),
      '[Serve] Closed the event log': () =>
        order.push(`log closed with the lock held: ${existsSync(join(config.dataDir, LOCK_FILE))}`),
    });
    try {
      await shinsa.stop();
    } finally {
      spy.mockRestore();
    }
    expect(order).toEqual([
      'effects settled',
      'eunoe stopped',
      'server stopped',
      'log closed with the lock held: true',
    ]);
    expect(await isListening()).toBe(false);
    expect(existsSync(join(config.dataDir, LOCK_FILE))).toBe(false);
  });

  test('inspect mode takes no lock, so it reads the data of a Shinsa that is running', async () => {
    const config = createTestConfig(createTempDir());
    const live = await startShinsa(config, { models });
    started.push(live);
    const inspect = await startShinsa({ ...config, inspect: true }, { models });
    expect(await selectLockHolder(config.dataDir)).toMatchObject({ pid: process.pid, url: live.url });
    await inspect.stop();
    expect((await selectLockHolder(config.dataDir))?.url).toBe(live.url);
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

function createAccountLayer(root: string, delay: Duration.Duration) {
  const signedOut = { ok: false, code: 1, stdout: '{"loggedIn": false}', stderr: '', timedOut: false };
  return Layer.mergeAll(
    Layer.succeed(
      Shell,
      Shell.of({
        run: (request) =>
          Effect.sleep(delay).pipe(
            Effect.andThen(
              request.argv[0] === 'cswap' ? Effect.die(new Error('cswap broke')) : Effect.succeed(signedOut)
            )
          ),
        stopTree: () => Effect.void,
      })
    ),
    Layer.succeed(
      TerminalPty,
      TerminalPty.of({
        spawn: () => Effect.die('not used'),
        readForeground: () => Effect.succeed(null),
        pickPort: () => Effect.die('not used'),
      })
    ),
    Layer.succeed(AccountsEnv, { CLAUDE_CONFIG_DIR: join(root, 'claude') }),
    Layer.succeed(KeychainPlatform, 'linux'),
    Layer.succeed(ClaudeCommandPath, Effect.succeed('claude'))
  );
}

describe('startShinsa with Claude accounts', () => {
  test('stopping waits for the account check, so it never reaches a released engine', async () => {
    const root = createTempDir();
    const config = createTestConfig(root, { roots: [createTempDir()] });
    const logs = captureLogs();
    const shinsa = await startShinsa(config, {
      models,
      triage: () => Effect.succeed(null),
      resolveLogin: () => Promise.resolve(null),
      accountLayer: createAccountLayer(root, Duration.millis(200)),
    });
    try {
      await shinsa.stop();
      await Bun.sleep(300);
      expect(logs.entries.filter((entry) => String(entry.error).includes('disposed'))).toEqual([]);
    } finally {
      logs.restore();
    }
  });

  test('serves the accounts and pushes them over the socket, even when checking them failed', async () => {
    const root = createTempDir();
    const config = createTestConfig(root, { roots: [createTempDir()] });
    const logs = captureLogs();
    const shinsa = await startShinsa(config, {
      models,
      triage: () => Effect.succeed(null),
      resolveLogin: () => Promise.resolve(null),
      accountLayer: createAccountLayer(root, Duration.zero),
    });
    started.push(shinsa);
    await until(
      'the failed check to be logged',
      () => logs.fieldsOf('[Serve] Could not check the Claude accounts').length > 0
    );
    logs.restore();
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
      error: { code: 'account_not_found', message: 'That account was removed.' },
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
