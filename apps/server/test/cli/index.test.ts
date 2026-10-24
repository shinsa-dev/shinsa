import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import type { ModelSource } from '../../src/agents/index.ts';
import { Transcripts } from '../../src/agents/index.ts';
import { type CliIo, createProcessIo, runCli, USAGE } from '../../src/cli/index.ts';
import { startServer } from '../../src/http/index.ts';
import { createServerInstance, ServerRunningError } from '../../src/instance/index.ts';
import { log } from '../../src/log/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import type { Shinsa } from '../../src/serve.ts';
import { SERVICE_MARKER, type ServiceControl } from '../../src/service/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import {
  createTempDir,
  createTestConfig,
  createTestOnboarding,
  overrideEnv,
  until,
  writeFiles,
} from '../helpers/index.ts';

setDefaultTimeout(30_000);

const stops: (() => Promise<void>)[] = [];

const HOME_DIR = createTempDir();

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

function startTestServer() {
  const config = createTestConfig(createTempDir(), { home: HOME_DIR });
  const engine = new Engine(new EventLog(config.databasePath));
  const http = startServer({
    engine,
    config,
    transcripts: new Transcripts(config.transcriptsDir),
    evidence: new EvidenceStore(config.evidenceDir),
    models: { listModels: () => Promise.resolve([]) } as unknown as ModelSource,
    onboarding: createTestOnboarding(engine, config).onboarding,
  });
  stops.push(http.stop);
  return { engine, port: String(http.server.port) };
}

function createIo(port: string, overrides: Partial<CliIo> = {}) {
  const out: string[] = [];
  const errors: string[] = [];
  const opened: string[] = [];
  const io: CliIo = {
    env: { SHINSA_PORT: port, SHINSA_HOME: HOME_DIR },
    cwd: '/code/app',
    write: (line = '') => out.push(line),
    writeError: (line) => errors.push(line),
    openUrl: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    serve: () => Promise.reject(new Error('not in this test')),
    onShutdown: () => undefined,
    ...overrides,
  };
  return { io, out, errors, opened };
}

describe('help and unknown commands', () => {
  test('help prints the usage, an unknown command prints it and fails', async () => {
    for (const command of ['help', '--help', '-h']) {
      const { io, out } = createIo('1');
      expect(await runCli([command], io)).toBe(0);
      expect(out).toEqual([USAGE]);
    }
    const { io, out } = createIo('1');
    expect(await runCli(['launch'], io)).toBe(1);
    expect(out).toEqual([USAGE]);
  });
});

describe('shinsa serve', () => {
  test('is the default command and stops on shutdown', async () => {
    let stopped = false;
    let registered: (() => Promise<void>) | null = null;
    const shinsa = {
      stop: () => {
        stopped = true;
        return Promise.resolve();
      },
    } as Shinsa;
    const { io } = createIo('1', {
      serve: () => Promise.resolve(shinsa),
      onShutdown: (stop) => {
        registered = stop;
      },
    });
    expect(await runCli([], io)).toBe(0);
    await (registered as unknown as () => Promise<void>)();
    expect(stopped).toBe(true);
  });

  const holder = {
    ...createServerInstance('a'.repeat(40), 1),
    pid: 4242,
    port: 5180,
    url: 'http://127.0.0.1:5180',
    bootedAt: 1,
  };

  test('started by the service onto a data folder another Shinsa holds, it says who and exits cleanly', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      const { io, errors } = createIo('1', {
        env: { [SERVICE_MARKER]: '1' },
        serve: () => Promise.reject(new ServerRunningError('/data', holder)),
      });
      expect(await runCli(['serve'], io)).toBe(0);
      expect(errors).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        '[Serve] Another Shinsa holds this data directory, so the service stays stopped',
        { dataDir: '/data', pid: 4242, url: 'http://127.0.0.1:5180', version: '0.0.0 (aaaaaaa)' }
      );
    } finally {
      warn.mockRestore();
    }
  });

  test('from a terminal the same lock is an error, and so is any other failure under the service', async () => {
    const running = createIo('1', { serve: () => Promise.reject(new ServerRunningError('/data', holder)) });
    expect(await runCli(['serve'], running.io)).toBe(1);
    expect(running.errors).toEqual([
      'shinsa serve: Shinsa is already running on /data: http://127.0.0.1:5180 (pid 4242, version 0.0.0 (aaaaaaa)). Stop it first, or set SHINSA_HOME to another folder.',
    ]);
    const broken = createIo('1', {
      env: { [SERVICE_MARKER]: '1' },
      serve: () => Promise.reject(new Error('port taken')),
    });
    expect(await runCli(['serve'], broken.io)).toBe(1);
    expect(broken.errors).toEqual(['shinsa serve: port taken']);
  });
});

describe('shinsa do', () => {
  test('hands the request over from the current directory and prints the task link', async () => {
    const { engine, port } = startTestServer();
    const { io, out } = createIo(port);
    expect(await runCli(['do', 'fix', 'the', 'scroll', '--urgent', '--plan-first'], io)).toBe(0);
    const task = Object.values(engine.state.tasks)[0];
    expect(task).toMatchObject({
      request: 'fix the scroll',
      priority: 'urgent',
      planFirst: true,
      origin: '/code/app',
    });
    expect(out).toEqual([
      'Started. Shinsa brings it back when it needs a decision.',
      `http://127.0.0.1:${port}/tasks/${task?.id}`,
    ]);
    await runCli(['do', 'another', '--high'], io);
    expect(Object.values(engine.state.tasks).map((candidate) => candidate.priority)).toContain('high');
  });

  test('an empty request, a server that is down or an invalid port fail with a plain message', async () => {
    const { io, errors } = createIo('1');
    expect(await runCli(['do'], io)).toBe(1);
    expect(await runCli(['do', 'x'], io)).toBe(1);
    expect(await runCli(['status'], { ...io, env: { SHINSA_PORT: 'abc' } })).toBe(1);
    expect(errors[0]).toBe('shinsa do: Say what should be done: shinsa do "fix the scroll in tab groups"');
    expect(errors[1]).toBe('shinsa do: Shinsa is not running on http://127.0.0.1:1. Start it with `shinsa`.');
    expect(errors[2]).toContain('SHINSA_PORT must be a whole number');
  });

  test('a server error and an answer without JSON are reported', async () => {
    const plain = Bun.serve({ port: 0, fetch: () => new Response('down', { status: 502 }) });
    const failing = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({ error: { code: 'x', message: 'Describe what you want done.' } }, { status: 400 }),
    });
    try {
      const first = createIo(String(plain.port));
      expect(await runCli(['status'], first.io)).toBe(1);
      expect(first.errors[0]).toContain('answered 502 without JSON');
      const second = createIo(String(failing.port));
      expect(await runCli(['do', 'x'], second.io)).toBe(1);
      expect(second.errors[0]).toBe('shinsa do: Describe what you want done.');
    } finally {
      plain.stop(true);
      failing.stop(true);
    }
  });
});

describe('shinsa import', () => {
  function writeSession(dir: string, name: string, cwd = '/code/app') {
    writeFiles(dir, {
      [name]: [
        JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: 'Build the importer' } }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Started on it.' }] },
        }),
      ].join('\n'),
    });
    return join(dir, name);
  }

  test('turns a session file or id into a task that starts with a plan', async () => {
    const { engine, port } = startTestServer();
    const projects = createTempDir();
    const path = writeSession(projects, 'proj/abc-123.jsonl', '/code/from-session');
    const { io, out } = createIo(port, { projectsDir: projects });
    expect(await runCli(['import', path], io)).toBe(0);
    expect(await runCli(['import', 'abc-123', '--in', '/code/elsewhere', '--high'], io)).toBe(0);
    const tasks = Object.values(engine.state.tasks);
    expect(tasks.map((task) => [task.origin, task.planFirst, task.priority])).toEqual([
      ['/code/from-session', true, 'normal'],
      ['/code/elsewhere', true, 'high'],
    ]);
    expect(out[0]).toBe(`Imported ${path}`);
    expect(tasks[0]?.request).toContain('What was asked first:\nBuild the importer');
  });

  test('a session without a working directory starts where shinsa ran', async () => {
    const { engine, port } = startTestServer();
    const projects = createTempDir();
    writeFiles(projects, {
      'p/s.jsonl': JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hi' } }),
    });
    const { io } = createIo(port, { projectsDir: projects });
    await runCli(['import', 's'], io);
    expect(Object.values(engine.state.tasks)[0]?.origin).toBe('/code/app');
  });

  test('a missing session name or --in value is explained', async () => {
    const { io, errors } = createIo('1');
    expect(await runCli(['import'], io)).toBe(1);
    expect(await runCli(['import', 'x', '--in'], io)).toBe(1);
    expect(errors).toEqual([
      'shinsa import: Name the session: shinsa import <session.jsonl | session-id>',
      'shinsa import: --in needs a value.',
    ]);
  });
});

describe('shinsa status and open', () => {
  test('status lists the briefing, the decisions and the agents at work', async () => {
    const queue = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          briefing: 'Review the search first.',
          decisions: [{ label: 'Review', title: 'Add search', url: 'http://x/tasks/1' }],
          working: [{ label: 'Building', title: 'Fix scroll' }],
        }),
    });
    const empty = Bun.serve({
      port: 0,
      fetch: () => Response.json({ briefing: null, decisions: [], working: [] }),
    });
    try {
      const { io, out } = createIo(String(queue.port));
      expect(await runCli(['status'], io)).toBe(0);
      expect(out).toEqual([
        'Review the search first.',
        '',
        'Needs you (1)',
        '  Review    Add search  http://x/tasks/1',
        '',
        'Agents working (1)',
        '  Building  Fix scroll',
      ]);
      const quiet = createIo(String(empty.port));
      await runCli(['status'], quiet.io);
      expect(quiet.out[0]).toBe('No briefing yet.');
    } finally {
      queue.stop(true);
      empty.stop(true);
    }
  });

  test('reaches the server on the host it is configured on', async () => {
    const server = Bun.serve({
      hostname: '::1',
      port: 0,
      fetch: () => Response.json({ briefing: 'On IPv6.', decisions: [], working: [] }),
    });
    try {
      const { io, out } = createIo(String(server.port));
      expect(await runCli(['status'], { ...io, env: { ...io.env, SHINSA_HOST: '::1' } })).toBe(0);
      expect(out[0]).toBe('On IPv6.');
    } finally {
      server.stop(true);
    }
  });

  test('open opens Shinsa or one task in the browser', async () => {
    const { io, opened } = createIo('1');
    await runCli(['open'], io);
    await runCli(['open', 'task/1'], io);
    expect(opened).toEqual(['http://127.0.0.1:1', 'http://127.0.0.1:1/tasks/task%2F1']);
  });
});

describe('the process io', () => {
  test('writes to stdout and stderr and opens URLs with open', async () => {
    const stdout = spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const io = createProcessIo();
      io.write();
      io.write('hello');
      io.writeError('oops');
      expect(stdout.mock.calls.map((call) => call[0])).toEqual(['\n', 'hello\n']);
      expect(stderr.mock.calls.map((call) => call[0])).toEqual(['oops\n']);
      await io.openUrl('http://127.0.0.1:5180');
      await expect(io.openUrl('fail')).rejects.toThrow('open fail failed: cannot open');
      expect(await runCli(['help'])).toBe(0);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  test('serve reads the login shell’s environment first, so the agents find the user’s tools', async () => {
    const restore = overrideEnv({ FAKE_LOGIN_SHELL_EXPORT: '1', FAKE_LOGIN_VAR: undefined });
    const path = process.env.PATH;
    try {
      const shinsa = await createProcessIo({ isTerminal: () => false }).serve({
        SHINSA_DATA_DIR: join(createTempDir(), 'data'),
        SHINSA_PORT: '0',
        SHINSA_INSPECT: '1',
      });
      stops.push(shinsa.stop);
      expect(process.env.FAKE_LOGIN_VAR).toBe('from the login shell');
      expect(process.env.PATH?.split(':')).toContain('/fake/login/bin');
    } finally {
      restore();
      process.env.PATH = path;
    }
  });

  test('serve started from a terminal keeps the terminal’s environment and reads no login shell', async () => {
    const restore = overrideEnv({ FAKE_LOGIN_SHELL_EXPORT: '1', FAKE_LOGIN_VAR: undefined });
    const path = process.env.PATH;
    const info = spyOn(log, 'info').mockImplementation(() => undefined);
    try {
      const shinsa = await createProcessIo({ isTerminal: () => true }).serve({
        SHINSA_DATA_DIR: join(createTempDir(), 'data'),
        SHINSA_PORT: '0',
        SHINSA_INSPECT: '1',
      });
      stops.push(shinsa.stop);
      expect(process.env.FAKE_LOGIN_VAR).toBeUndefined();
      expect(process.env.PATH).toBe(path);
      expect(info).toHaveBeenCalledWith(
        '[Serve] Started from a terminal, so the login shell environment is not read'
      );
    } finally {
      info.mockRestore();
      restore();
    }
  });

  test('serve drops the service’s marker, so nothing it runs thinks launchd started it', async () => {
    const restore = overrideEnv({ [SERVICE_MARKER]: '1' });
    try {
      const shinsa = await createProcessIo({ isTerminal: () => true }).serve({
        SHINSA_DATA_DIR: join(createTempDir(), 'data'),
        SHINSA_PORT: '0',
        SHINSA_INSPECT: '1',
      });
      stops.push(shinsa.stop);
      expect(process.env[SERVICE_MARKER]).toBeUndefined();
    } finally {
      restore();
    }
  });

  test('serve starts Shinsa from the environment and a signal stops it', async () => {
    const exit = spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      const io = createProcessIo();
      const shinsa = await io.serve({
        SHINSA_DATA_DIR: join(createTempDir(), 'data'),
        SHINSA_PORT: '0',
        SHINSA_INSPECT: '1',
      });
      let attempts = 0;
      stops.push(async () => {
        if (attempts === 0) await shinsa.stop();
      });
      io.onShutdown(() => {
        attempts += 1;
        if (attempts === 1) return shinsa.stop();
        return Promise.reject(new Error('already stopped'));
      });
      process.emit('SIGTERM');
      await until('the first stop to exit', () => exit.mock.calls.length === 1);
      process.emit('SIGINT');
      await until('the second stop to exit', () => exit.mock.calls.length === 2);
      expect(attempts).toBe(2);
      expect(exit.mock.calls).toEqual([[0], [1]]);
    } finally {
      exit.mockRestore();
    }
  });
});

describe('the background service from the command line', () => {
  const service: ServiceControl = {
    install: () => Promise.reject(new Error('not in this test')),
    uninstall: () => Promise.reject(new Error('not in this test')),
    status: () =>
      Promise.resolve({
        label: 'studio.overclock.shinsa',
        plist: '/p.plist',
        log: '/serve.log',
        installed: false,
        loaded: false,
        state: null,
        pid: null,
        lastExitCode: null,
        server: null,
      }),
    restart: () => Promise.reject(new Error('not in this test')),
    logs: () => ({ path: '/serve.log', lines: [] }),
  };

  test('works with no server running, as text or JSON', async () => {
    const { io, out } = createIo('1', { service });
    expect(await runCli(['service', 'status'], io)).toBe(0);
    expect(out[0]?.split('\n')[0]).toBe('Service: not installed');
    expect(await runCli(['service', 'status', '--json'], io)).toBe(0);
    expect(JSON.parse(out[1] ?? '')).toMatchObject({ loaded: false, server: null });
  });

  test('the command line always has it; without it the command explains who runs it', async () => {
    expect(createProcessIo().service).toBeDefined();
    const { io, errors } = createIo('1');
    expect(await runCli(['service', 'logs'], io)).toBe(1);
    expect(errors).toEqual([
      'shinsa service: Only the `shinsa` command line manages the background service, from your own terminal.',
    ]);
  });
});

describe('managing Shinsa from the command line', () => {
  test('a group alone, or with help, lists its commands', async () => {
    for (const args of [['tasks'], ['tasks', '--help'], ['tasks', 'help'], ['tasks', 'launch', '-h']]) {
      const { io, out } = createIo('1');
      expect(await runCli(args, io)).toBe(0);
      expect(out[0]?.split('\n').slice(0, 3)).toEqual([
        'shinsa tasks',
        '',
        `  shinsa ${'tasks list'.padEnd(26)} List tasks, most recently changed first.`,
      ]);
    }
  });

  test('a command with --help prints its usage and sends nothing', async () => {
    const { engine, port } = startTestServer();
    const { io, out } = createIo(port);
    expect(await runCli(['tasks', 'create', '--help'], io)).toBe(0);
    expect(out[0]).toContain('Usage\n  shinsa tasks create <request...>');
    expect(engine.state.tasks).toEqual({});
  });

  test('creates a task, then lists and shows it by the start of its id, as text or JSON', async () => {
    const { engine, port } = startTestServer();
    const created = createIo(port);
    expect(await runCli(['tasks', 'create', 'Fix', 'the', 'scroll', '--priority', 'high'], created.io)).toBe(
      0
    );
    const task = Object.values(engine.state.tasks)[0];
    expect(task).toMatchObject({ request: 'Fix the scroll', priority: 'high' });
    expect(created.out).toEqual([
      `Created the task. Shinsa brings it back when it needs a decision.\nhttp://127.0.0.1:${port}/tasks/${task?.id}`,
    ]);
    const listed = createIo(port);
    expect(await runCli(['tasks', 'list', '--json'], listed.io)).toBe(0);
    expect(JSON.parse(listed.out[0] ?? '')).toMatchObject({ tasks: [{ id: task?.id, priority: 'high' }] });
    const shown = createIo(port);
    expect(await runCli(['tasks', 'show', (task?.id ?? '').slice(0, 12)], shown.io)).toBe(0);
    expect(shown.out[0]).toContain(task?.title ?? 'missing');
    const json = createIo(port);
    expect(await runCli(['tasks', 'create', 'Add search', '--json'], json.io)).toBe(0);
    expect(JSON.parse(json.out[0] ?? '')).toEqual({ ok: true, taskId: expect.any(String), handle: null });
  });

  test('a command repeated under the same --idempotency-key is applied once', async () => {
    const { engine, port } = startTestServer();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { io } = createIo(port);
      expect(await runCli(['tasks', 'create', 'Fix it', '--idempotency-key', 'retry-1'], io)).toBe(0);
    }
    expect(Object.keys(engine.state.tasks)).toHaveLength(1);
  });

  test('a failure is an error line, or a JSON error with the server’s code under --json', async () => {
    const { port } = startTestServer();
    const plain = createIo(port);
    expect(await runCli(['tasks', 'show', 'nope'], plain.io)).toBe(1);
    expect(plain.errors).toEqual(['shinsa tasks: No task nope. `shinsa tasks list` lists them.']);
    const json = createIo(port);
    expect(await runCli(['tasks', 'show', 'nope', '--json'], json.io)).toBe(1);
    expect(JSON.parse(json.out[0] ?? '')).toEqual({
      error: { code: 'task_not_found', message: 'No task nope. `shinsa tasks list` lists them.' },
    });
    const down = createIo('1');
    expect(await runCli(['usage', '--json'], down.io)).toBe(1);
    expect(JSON.parse(down.out[0] ?? '')).toEqual({
      error: {
        code: 'command_failed',
        message: 'Shinsa is not running on http://127.0.0.1:1. Start it with `shinsa`.',
      },
    });
    const invalid = createIo('1');
    expect(await runCli(['tasks', 'list', '--status', 'later', '--json'], invalid.io)).toBe(1);
    expect(JSON.parse(invalid.out[0] ?? '')).toMatchObject({ error: { code: 'arguments_invalid' } });
  });

  test('an unknown command in a group says how to see the group', async () => {
    const { io, errors } = createIo('1');
    expect(await runCli(['tasks', 'launch', 'now'], io)).toBe(1);
    expect(errors).toEqual(['shinsa tasks: No command shinsa tasks launch. Run `shinsa tasks --help`.']);
  });

  test('the usage lists every managing command', () => {
    expect(USAGE).toContain(`  shinsa ${'schedules write'.padEnd(26)} Create a schedule`);
  });
});
