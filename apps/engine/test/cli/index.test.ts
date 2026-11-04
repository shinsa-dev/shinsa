import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Fiber } from 'effect';
import type { ModelSource } from '../../src/agents/index.ts';
import { NOT_RUNNING } from '../../src/cli/api.ts';
import { ENGINE_STOPPED } from '../../src/cli/engine.ts';
import { describeHelp, describeHelpAll } from '../../src/cli/help.ts';
import {
  type CliIo,
  createOpenApp,
  createPlatformService,
  createProcessIo,
  createWakeEngine,
  stopEngineFiber,
  trimEngineLog,
  writeOutputTo,
} from '../../src/cli/index.ts';
import { createLaunchdService } from '../../src/cli/launchd.ts';
import { CliLayer } from '../../src/cli/layers.ts';
import { CliFailed, type ProcessOptions } from '../../src/cli/schema.ts';
import {
  createServerInstance,
  resolveBundle,
  SERVICE_MARKER,
  createServerRunningError,
} from '../../src/instance/index.ts';
import { createStyle, UNICODE_SYMBOLS } from '../../src/terminal/style.ts';
import { runFiles } from '../harness.ts';
import { Engine } from '../helpers/engine.ts';
import { openEventLog } from '../helpers/event-log.ts';
import { createTestEvidence } from '../helpers/evidence.ts';
import {
  createTempDir,
  createTestConfig,
  createTestOnboarding,
  captureLogs,
  createTestTerminal,
  overrideEnv,
  until,
  writeFiles,
} from '../helpers/index.ts';
import { startShinsa } from '../helpers/serve.ts';
import { createTestTranscripts } from '../helpers/transcripts.ts';
import { startHttpServer } from '../helpers/web.ts';
import { runCli, runCliEffect } from './harness.ts';

setDefaultTimeout(30_000);

const COLOR = { style: createStyle({ color: true, symbols: UNICODE_SYMBOLS }), width: 100 };

const stops: (() => Promise<void>)[] = [];

const HOME_DIR = createTempDir();

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

function startTestServer() {
  const config = createTestConfig(createTempDir(), { home: HOME_DIR });
  const engine = new Engine(openEventLog(config.databasePath));
  const http = startHttpServer({
    engine,
    config,
    transcripts: createTestTranscripts(config.transcriptsDir),
    evidence: createTestEvidence(config.evidenceDir),
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
    openApp: (link) =>
      Effect.sync(() => {
        opened.push(link);
      }),
    readRepoRoot: () => Effect.succeed(null),
    wakeEngine: Effect.succeed(false),
    engine: {
      bundled: false,
      service: createLaunchdService({
        uid: 501,
        ownsJob: () => Effect.succeed(true),
        launchctl: () => Effect.succeed({ ok: false, output: '' }),
      }),
    },
    runEngine: () => Effect.die(new Error('not in this test')),
    terminal: createTestTerminal(),
    ...overrides,
  };
  return { io, out, errors, opened };
}

describe('help and unknown commands', () => {
  test('help prints the usage, and an unknown command says where the list is', async () => {
    for (const command of ['help', '--help', '-h']) {
      const { io, out } = createIo('1');
      expect(await runCli([command], io)).toBe(0);
      expect(out).toEqual([describeHelp()]);
    }
    for (const command of ['launch', 'serve']) {
      const { io, out, errors } = createIo('1');
      expect(await runCli([command], io)).toBe(1);
      expect(out).toEqual([]);
      expect(errors).toEqual([`Error: No command shinsa ${command}.`, 'Run `shinsa help` for the list.']);
    }
    const typo = createIo('1');
    expect(await runCli(['statsu'], typo.io)).toBe(1);
    expect(typo.errors).toEqual([
      'Error: No command shinsa statsu.',
      'Did you mean `shinsa status`? Run `shinsa help` for the list.',
    ]);
    const colored = createIo('1', { terminal: createTestTerminal(COLOR) });
    await runCli(['tsks'], colored.io);
    expect(colored.errors).toEqual([
      '\u001b[31m\u001b[1mError:\u001b[22m\u001b[39m No command shinsa tsks.',
      '\u001b[2mDid you mean \u001b[36mshinsa tasks\u001b[39m? Run \u001b[36mshinsa help\u001b[39m for the list.\u001b[22m',
    ]);
  });

  test('help in a terminal is styled, and help piped stays plain', async () => {
    const colored = createIo('1', { terminal: createTestTerminal(COLOR) });
    await runCli(['help'], colored.io);
    expect(colored.out).toEqual([describeHelp(COLOR)]);
    expect(colored.out[0]).toContain('\u001b[1m');
    const plain = createIo('1');
    await runCli(['help'], plain.io);
    expect(plain.out[0]).not.toContain('\u001b');
  });

  test('help takes a command or a group, --all lists everything, and --help works on every command', async () => {
    const all = createIo('1');
    expect(await runCli(['help', '--all'], all.io)).toBe(0);
    expect(all.out).toEqual([describeHelpAll()]);
    const topic = createIo('1');
    expect(await runCli(['help', 'do'], topic.io)).toBe(0);
    expect(await runCli(['do', '--help'], topic.io)).toBe(0);
    expect(await runCli(['stop', '-h'], topic.io)).toBe(0);
    expect(await runCli(['help', 'tasks'], topic.io)).toBe(0);
    expect(topic.out[0]).toStartWith(
      'Create a task from a request; Shinsa picks the kind of work and runs it.\n\nUsage\n  shinsa do <request...>'
    );
    expect(topic.out[1]).toBe(topic.out[0]);
    expect(topic.out[2]).toStartWith('Stop the engine cleanly.');
    expect(topic.out[3]).toStartWith('List, open and create tasks;');
    const unknown = createIo('1');
    expect(await runCli(['help', 'launch'], unknown.io)).toBe(1);
    expect(unknown.errors).toEqual(['Error: No command shinsa launch.', 'Run `shinsa help` for the list.']);
  });
});

describe('the engine commands', () => {
  function startHealth(state: { pid: number | null }) {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        state.pid === null
          ? new Response('stopped', { status: 503 })
          : Response.json({ version: '0.0.0', commit: null, pid: state.pid, protocol: 3 }),
    });
    stops.push(() => Promise.resolve(server.stop(true)));
    return String(server.port);
  }

  test('start, stop, restart and version reach the engine through launchd', async () => {
    const state: { pid: number | null } = { pid: 7 };
    const calls: string[][] = [];
    const { io, out, errors } = createIo(startHealth(state), {
      engine: {
        bundled: true,
        waitMs: 2000,
        service: createLaunchdService({
          uid: 501,
          ownsJob: () => Effect.succeed(true),
          launchctl: (args) => {
            calls.push(args);
            if (args[1] === '-k') state.pid = 8;
            if (args[0] === 'kill') state.pid = null;
            return Effect.succeed({ ok: true, output: '' });
          },
        }),
      },
    });
    expect(await runCli(['start'], io)).toBe(0);
    expect(await runCli(['version'], io)).toBe(0);
    expect(await runCli(['--version'], io)).toBe(0);
    expect(await runCli(['-v', '--json'], io)).toBe(0);
    expect(await runCli(['restart'], io)).toBe(0);
    expect(await runCli(['stop'], io)).toBe(0);
    expect(out.slice(0, 3)).toEqual([
      'The engine is already running. Shinsa 0.0.0, pid 7.',
      'Command  0.0.0',
      'Engine   0.0.0, pid 7, protocol 3',
    ]);
    expect(JSON.parse(out[5] ?? '')).toMatchObject({ engine: { pid: 7 } });
    expect(out.slice(6)).toEqual([
      expect.stringMatching(/^Restarted the engine in \d+(?:ms|\.\ds)\. Shinsa 0\.0\.0, pid 8\.$/),
      expect.stringMatching(/^Stopped the engine in \d+(?:ms|\.\ds)\. Runs it cut off resume/),
    ]);
    expect(calls.map((call) => call[0])).toEqual(['print', 'kickstart', 'print', 'kill']);
    expect(errors).toEqual([]);
  });

  test('restart --when-idle asks the engine itself, which has to be running', async () => {
    const { io, errors } = createIo('1', {
      engine: {
        bundled: true,
        service: createLaunchdService({
          uid: 501,
          ownsJob: () => Effect.succeed(true),
          launchctl: () => Effect.succeed({ ok: true, output: '' }),
        }),
      },
    });
    expect(await runCli(['restart', '--when-idle'], io)).toBe(1);
    expect(errors).toEqual([
      'Error: The engine is not running.',
      '`shinsa start` starts it, and so does opening the Shinsa app.',
    ]);
    expect(errors.join(' ')).toBe(`Error: ${ENGINE_STOPPED}`);
  });

  test('a flag that needs a value says so', async () => {
    const { io, errors } = createIo('1');
    expect(await runCli(['version', '--lines'], io)).toBe(1);
    expect(errors).toEqual(['Error: --lines needs a value.']);
  });

  test('logs reads the engine log in the data folder', async () => {
    const home = createTempDir();
    writeFiles(home, { 'data/engine.log': 'started\n' });
    const { io, out } = createIo('1', { env: { SHINSA_HOME: home } });
    expect(await runCli(['logs'], io)).toBe(0);
    expect(out).toEqual(['started']);
  });
});

describe('shinsa engine', () => {
  test('answers 0 once the engine has stopped', async () => {
    let ran = false;
    const { io, errors } = createIo('1', {
      runEngine: () =>
        Effect.sync(() => {
          ran = true;
        }),
    });
    expect(await runCli(['engine'], io)).toBe(0);
    expect(ran).toBe(true);
    expect(errors).toEqual([]);
  });

  const holder = {
    ...createServerInstance('a'.repeat(40), 1),
    pid: 4242,
    port: 5180,
    url: 'http://127.0.0.1:5180',
    bootedAt: 1,
  };

  test('started by the service onto a data folder another Shinsa holds, it says who and exits cleanly', async () => {
    const logs = captureLogs();
    try {
      const { io, errors } = createIo('1', {
        env: { [SERVICE_MARKER]: '1' },
        runEngine: () => Effect.fail(createServerRunningError('/data', holder)),
      });
      expect(await runCli(['engine'], io)).toBe(0);
      expect(errors).toEqual([]);
      expect(
        logs.fieldsOf('[Serve] Another Shinsa holds this data directory, so the service stays stopped')
      ).toEqual([{ dataDir: '/data', pid: 4242, url: 'http://127.0.0.1:5180', version: '0.0.0 (aaaaaaa)' }]);
    } finally {
      logs.restore();
    }
  });

  test('from a terminal the same lock is an error, and so is any other failure under the service', async () => {
    const running = createIo('1', {
      runEngine: () => Effect.fail(createServerRunningError('/data', holder)),
    });
    expect(await runCli(['engine'], running.io)).toBe(1);
    expect(running.errors).toEqual([
      'Error: Shinsa is already running on /data: http://127.0.0.1:5180 (pid 4242, version 0.0.0 (aaaaaaa)). Stop it first, or set SHINSA_HOME to another folder.',
    ]);
    const broken = createIo('1', {
      env: { [SERVICE_MARKER]: '1' },
      runEngine: () => Effect.fail(new CliFailed({ message: 'port taken' })),
    });
    expect(await runCli(['engine'], broken.io)).toBe(1);
    expect(broken.errors).toEqual(['Error: port taken']);
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
    const colored = createIo(port, { terminal: createTestTerminal(COLOR) });
    await runCli(['do', 'one', 'more'], colored.io);
    expect(colored.out[0]).toBe(
      '\u001b[32m✔\u001b[39m Started. Shinsa brings it back when it needs a decision.'
    );
    expect(colored.out[1]).toStartWith('\u001b[2mhttp://');
    await runCli(['do', 'another', '--high'], io);
    expect(Object.values(engine.state.tasks).map((candidate) => candidate.priority)).toContain('high');
  });

  test('--backlog files the task for the backlog', async () => {
    const { engine, port } = startTestServer();
    const { io, out } = createIo(port);
    expect(await runCli(['do', 'add', 'search', '--backlog'], io)).toBe(0);
    const task = Object.values(engine.state.tasks)[0];
    expect(task?.backlog).toEqual({ at: expect.any(Number) });
    expect(out[0]).toBe('Added to the backlog. It plans now and builds when you start it.');
  });

  test('an empty request, a server that is down or an invalid port fail with a plain message', async () => {
    const { io, errors } = createIo('1');
    expect(await runCli(['do'], io)).toBe(1);
    expect(await runCli(['do', 'x'], io)).toBe(1);
    expect(await runCli(['status'], { ...io, env: { SHINSA_PORT: 'abc' } })).toBe(1);
    expect(errors[0]).toBe(
      'Error: Say what should be done, such as `shinsa do "fix the scroll in tab groups"`.'
    );
    expect(errors[1]).toBe('Error: Shinsa is not running.');
    expect(errors[2]).toBe('Start it with `shinsa start`, or open the Shinsa app on a Mac.');
    expect(errors[3]).toContain('SHINSA_PORT must be a whole number');
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
      expect(await runCli(['do', 'x'], first.io)).toBe(1);
      expect(first.errors[0]).toContain('answered 502 without JSON');
      const second = createIo(String(failing.port));
      expect(await runCli(['do', 'x'], second.io)).toBe(1);
      expect(second.errors[0]).toBe('Error: Describe what you want done.');
    } finally {
      void plain.stop(true);
      void failing.stop(true);
    }
  });
});

describe('shinsa status and open', () => {
  const HEALTH = {
    ok: true,
    seq: 3,
    problems: [],
    version: '0.0.0',
    commit: null,
    installPath: '/Users/you/Shinsa.app',
    pid: 42,
    protocol: 3,
    dataDir: '/data',
    uptimeMs: 7_200_000,
  };

  function routeStatus(queue: unknown, health: unknown = HEALTH) {
    return (request: Request) =>
      Response.json(new URL(request.url).pathname === '/api/health' ? health : queue);
  }

  const QUIET = { briefing: null, decisions: [], working: [] };

  test('status names the engine, then the briefing, the decisions and the agents at work', async () => {
    const queue = Bun.serve({
      port: 0,
      fetch: routeStatus({
        briefing: 'Review the search first.',
        decisions: [
          {
            taskId: 't1',
            handle: 'SW-1',
            label: 'Review',
            kind: 'review',
            title: 'Add search',
            url: 'http://x/tasks/SW-1',
          },
        ],
        working: [
          { taskId: 't2', handle: 'SW-2', label: 'building', kind: 'building', title: 'Fix scroll', url: '' },
        ],
      }),
    });
    const empty = Bun.serve({
      port: 0,
      fetch: routeStatus(QUIET, { ...HEALTH, ok: false, problems: [{}] }),
    });
    const damaged = Bun.serve({
      port: 0,
      fetch: routeStatus(QUIET, { ...HEALTH, ok: false, problems: [{}, {}] }),
    });
    try {
      const { io, out } = createIo(String(queue.port));
      expect(await runCli(['status'], io)).toBe(0);
      expect(out).toEqual([
        'Running  Shinsa 0.0.0',
        'Uptime   2 hours',
        `Address  http://127.0.0.1:${queue.port}`,
        'Process  42',
        'Engine   ~/Shinsa.app',
        'Data     /data',
        '',
        'Review the search first.',
        '',
        'Needs you  1',
        '  SW-1  Review    Add search  http://x/tasks/SW-1',
        '',
        'Agents working  1',
        '  SW-2  building  Fix scroll',
      ]);
      const colored = createIo(String(queue.port), { terminal: createTestTerminal(COLOR) });
      await runCli(['status'], colored.io);
      expect(colored.out.slice(0, 2)).toEqual([
        '\u001b[32m●\u001b[39m \u001b[1mRunning\u001b[22m  Shinsa 0.0.0',
        '  \u001b[2mUptime\u001b[22m   2 hours',
      ]);
      const quiet = createIo(String(empty.port));
      await runCli(['status'], quiet.io);
      expect(quiet.out.slice(6)).toEqual([
        '',
        'It skipped 1 damaged entry in its log at start. `shinsa health` shows it.',
        '',
        'Nothing needs you, and no agent is working.',
      ]);
      const worse = createIo(String(damaged.port), { terminal: createTestTerminal(COLOR) });
      await runCli(['status'], worse.io);
      expect(worse.out[7]).toBe(
        '\u001b[33m▲\u001b[39m It skipped 2 damaged entries in its log at start. \u001b[36mshinsa health\u001b[39m lists them.'
      );
      const json = createIo(String(queue.port));
      expect(await runCli(['status', '--json'], json.io)).toBe(0);
      expect(JSON.parse(json.out[0] ?? '')).toMatchObject({ engine: { pid: 42 }, queue: { working: [{}] } });
    } finally {
      void queue.stop(true);
      void empty.stop(true);
      void damaged.stop(true);
    }
  });

  test('status says the engine is not running, and never starts it', async () => {
    let woken = false;
    const { io, out } = createIo('1', {
      wakeEngine: Effect.sync(() => {
        woken = true;
        return true;
      }),
    });
    expect(await runCli(['status'], io)).toBe(1);
    expect(await runCli(['status', '--json'], io)).toBe(1);
    expect(out.slice(0, 2)).toEqual([
      'Stopped  The engine is not running.',
      '`shinsa start` starts it, and so does opening the Shinsa app.',
    ]);
    expect(JSON.parse(out[2] ?? '')).toEqual({ engine: null, queue: null });
    const colored = createIo('1', { terminal: createTestTerminal(COLOR) });
    expect(await runCli(['status'], colored.io)).toBe(1);
    expect(colored.out).toEqual([
      '\u001b[31m●\u001b[39m \u001b[1mStopped\u001b[22m  The engine is not running.',
      '  \u001b[2m\u001b[36mshinsa start\u001b[39m starts it, and so does opening the Shinsa app.\u001b[22m',
    ]);
    expect(woken).toBe(false);
  });

  test('reaches the server on the host it is configured on', async () => {
    const server = Bun.serve({
      hostname: '::1',
      port: 0,
      fetch: routeStatus({ briefing: 'On IPv6.', decisions: [], working: [] }),
    });
    try {
      const { io, out } = createIo(String(server.port));
      expect(await runCli(['status'], { ...io, env: { ...io.env, SHINSA_HOST: '::1' } })).toBe(0);
      expect(out[1]).toBe(`Uptime   ${'2 hours'}`);
      expect(out[7]).toBe('On IPv6.');
    } finally {
      void server.stop(true);
    }
  });

  test('shinsa alone and open open the app, on Home or on one task', async () => {
    const { io, opened } = createIo('1');
    expect(await runCli([], io)).toBe(0);
    await runCli(['open'], io);
    await runCli(['open', 'SW-142'], io);
    expect(opened).toEqual(['shinsa://home', 'shinsa://home', 'shinsa://task/SW-142']);
  });

  test('a folder opens the app focused on its project, or says why it cannot', async () => {
    const { port } = startTestServer();
    const repoPath = join(createTempDir(), 'shop');
    const { io, opened, out } = createIo(port, {
      readRepoRoot: (dir) => Effect.succeed(dir === '/code/app' ? repoPath : null),
    });
    expect(await runCli(['.'], io)).toBe(0);
    expect(await runCli(['open', '/elsewhere'], io)).toBe(0);
    expect(opened).toEqual(['shinsa://home', 'shinsa://home']);
    expect(out).toEqual([
      `Shinsa has not worked in ${repoPath} yet. Ask for something there and it joins your projects.`,
      '/elsewhere is not in a git repository, so Shinsa opens on Home.',
    ]);
  });
});

describe('opening the app', () => {
  test('a browser that cannot be started is an error naming the command', async () => {
    const restore = overrideEnv({ PATH: createTempDir() });
    try {
      const failure = await runCliEffect(
        Effect.flip(
          createOpenApp('http://127.0.0.1:7446', {
            write: () => undefined,
            inApp: false,
            platform: 'darwin',
          })('shinsa://home')
        )
      );
      expect(failure).toBeInstanceOf(CliFailed);
      expect(failure.message).toContain('open http://127.0.0.1:7446/');
    } finally {
      restore();
    }
  });

  test('the Mac app opens the link, a checkout opens the page in the browser, and a headless box prints it', async () => {
    const openLog = join(createTempDir(), 'opened');
    const restore = overrideEnv({ FAKE_OPEN_LOG: openLog });
    const printed: string[] = [];
    const write = (line: string) => printed.push(line);
    try {
      await runCliEffect(
        createOpenApp('http://127.0.0.1:7446', { write, inApp: true, platform: 'darwin' })('shinsa://home')
      );
      await runCliEffect(
        createOpenApp('http://127.0.0.1:7446', { write, inApp: false, platform: 'darwin', env: {} })(
          'shinsa://task/SW-1'
        )
      );
      await runCliEffect(
        createOpenApp('http://127.0.0.1:7446', {
          write,
          inApp: true,
          platform: 'linux',
          env: { DISPLAY: ':0' },
        })('shinsa://home')
      );
      await runCliEffect(
        createOpenApp('http://127.0.0.1:7446', { write, inApp: true, platform: 'linux', env: {} })(
          'shinsa://task/SW-1'
        )
      );
      expect(readFileSync(openLog, 'utf8').trim().split('\n')).toEqual([
        expect.stringMatching(/^-b \S+ shinsa:\/\/home$/),
        'http://127.0.0.1:7446/tasks/SW-1',
        'http://127.0.0.1:7446/',
      ]);
      expect(printed).toEqual([
        'No display here, so open http://127.0.0.1:7446/tasks/SW-1 in a browser that reaches this machine.',
      ]);
    } finally {
      restore();
    }
  });
});

const INSPECT_READY = '[Serve] Inspect mode: agents, pull request sync and recovery are off';

function createInspectEnv(dataDir = join(createTempDir(), 'data')) {
  return { SHINSA_DATA_DIR: dataDir, SHINSA_PORT: '0', SHINSA_INSPECT: '1' };
}

async function runProcessEngine(
  options: ProcessOptions,
  env: Record<string, string | undefined>,
  started: () => boolean
) {
  const codes: number[] = [];
  const fiber = Effect.runFork(
    createProcessIo({ ...options, exit: (code) => codes.push(code) }).pipe(
      Effect.flatMap((io) => io.runEngine(env)),
      Effect.provide(CliLayer)
    )
  );
  await until('the engine to start', started);
  await Effect.runPromise(Fiber.interrupt(fiber));
  return codes;
}

describe('the process io', () => {
  test('writes to stdout and stderr, opens the page in a checkout and finds a repository root', async () => {
    const stdout = spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const io = await runCliEffect(createProcessIo());
      io.write();
      io.write('hello');
      io.writeError('oops');
      expect(stdout.mock.calls.map((call) => call[0])).toEqual(['\n', 'hello\n']);
      expect(stderr.mock.calls.map((call) => call[0])).toEqual(['oops\n']);
      await runCliEffect(io.openApp('shinsa://task/SW-1'));
      expect(await runCliEffect(io.wakeEngine)).toBe(false);
      const repo = createTempDir();
      Bun.spawnSync(['git', 'init', '-q'], { cwd: repo });
      expect(await runCliEffect(io.readRepoRoot(join(repo, '.')))).toBe(
        Bun.spawnSync(['git', '-C', repo, 'rev-parse', '--show-toplevel']).stdout.toString().trim()
      );
      expect(await runCliEffect(io.readRepoRoot(createTempDir()))).toBeNull();
      expect(await runCli(['help'])).toBe(0);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  test('the engine reads the login shell’s environment first, so the agents find the user’s tools', async () => {
    const restore = overrideEnv({ FAKE_LOGIN_SHELL_EXPORT: '1', FAKE_LOGIN_VAR: undefined });
    const path = process.env.PATH;
    const logs = captureLogs();
    try {
      const codes = await runProcessEngine(
        { isTerminal: () => false },
        createInspectEnv(),
        () => logs.fieldsOf(INSPECT_READY).length === 1
      );
      expect(codes).toEqual([0]);
      expect(process.env.FAKE_LOGIN_VAR).toBe('from the login shell');
      expect(process.env.PATH?.split(':')).toContain('/fake/login/bin');
    } finally {
      logs.restore();
      restore();
      process.env.PATH = path;
    }
  });

  test('the engine started from a terminal keeps the terminal’s environment and reads no login shell', async () => {
    const restore = overrideEnv({ FAKE_LOGIN_SHELL_EXPORT: '1', FAKE_LOGIN_VAR: undefined });
    const path = process.env.PATH;
    const logs = captureLogs();
    try {
      await runProcessEngine(
        { isTerminal: () => true },
        createInspectEnv(),
        () => logs.fieldsOf(INSPECT_READY).length === 1
      );
      expect(process.env.FAKE_LOGIN_VAR).toBeUndefined();
      expect(process.env.PATH).toBe(path);
      expect(
        logs.fieldsOf('[Serve] Started from a terminal, so the login shell environment is not read')
      ).toEqual([{}]);
    } finally {
      logs.restore();
      restore();
    }
  });

  test('the engine drops the service’s marker, so nothing it runs thinks launchd started it', async () => {
    const restore = overrideEnv({ [SERVICE_MARKER]: '1' });
    const logs = captureLogs();
    try {
      await runProcessEngine(
        { isTerminal: () => true },
        createInspectEnv(),
        () => logs.fieldsOf(INSPECT_READY).length === 1
      );
      expect(process.env[SERVICE_MARKER]).toBeUndefined();
    } finally {
      logs.restore();
      restore();
    }
  });

  test('a signal interrupts the engine, which stops and exits 0 so its service leaves it stopped', async () => {
    const logs = captureLogs();
    try {
      const codes = await runProcessEngine(
        { isTerminal: () => true },
        createInspectEnv(),
        () => logs.fieldsOf(INSPECT_READY).length === 1
      );
      expect(codes).toEqual([0]);
      expect(logs.fieldsOf('[Serve] Stopping')).toEqual([{}]);
      expect(logs.fieldsOf('[Serve] Closed the event log')).toEqual([{}]);
    } finally {
      logs.restore();
    }
  });

  test('an engine whose data folder another engine holds answers who holds it', async () => {
    const config = createTestConfig(createTempDir());
    const running = await startShinsa(config, { models: { listModels: Effect.succeed([]) } as never });
    try {
      const io = await runCliEffect(createProcessIo({ isTerminal: () => true }));
      const failure = await runCliEffect(
        Effect.flip(io.runEngine({ SHINSA_DATA_DIR: config.dataDir, SHINSA_PORT: '0' }))
      );
      expect(failure).toMatchObject({ _tag: 'ServerRunningError' });
    } finally {
      await running.stop();
    }
  });

  test('an engine whose port is taken answers why, and the command says it', async () => {
    const taken = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
    try {
      const io = await runCliEffect(createProcessIo({ isTerminal: () => true }));
      const failure = await runCliEffect(
        Effect.flip(io.runEngine({ ...createInspectEnv(), SHINSA_PORT: String(taken.port) }))
      );
      expect(failure).toBeInstanceOf(CliFailed);
      expect(failure.message).toContain(String(taken.port));
    } finally {
      await taken.stop(true);
    }
  });
});

describe('waking the engine', () => {
  test('asks launchd only in the app, and waits until the engine answers', async () => {
    const { port } = startTestServer();
    const live = `http://127.0.0.1:${port}`;
    const kicked = Effect.succeed(true);
    expect(await runCliEffect(Effect.flatten(createWakeEngine(live, { bundled: false, kick: kicked })))).toBe(
      false
    );
    expect(
      await runCliEffect(
        Effect.flatten(createWakeEngine(live, { bundled: true, kick: Effect.succeed(false) }))
      )
    ).toBe(false);
    expect(await runCliEffect(Effect.flatten(createWakeEngine(live, { bundled: true, kick: kicked })))).toBe(
      true
    );
    expect(
      await runCliEffect(
        Effect.flatten(createWakeEngine('http://127.0.0.1:1', { bundled: true, kick: kicked, waitMs: 300 }))
      )
    ).toBe(false);
  });

  test('the platform picks systemd on Linux and launchd elsewhere, which leaves a job it does not own alone', async () => {
    expect((await runFiles(createPlatformService('linux', { HOME: '/home/dev' }))).manager).toBe('systemd');
    const launchd = await runFiles(createPlatformService('darwin'));
    expect(launchd.manager).toBe('launchd');
    expect(await runCliEffect(launchd.kick)).toBe(false);
  });

  test('the engine the app starts writes to its log file and finds the shinsa command on its PATH', async () => {
    const root = createTempDir();
    const bundle = resolveBundle(
      { version: '1.2.3', commit: '', stateVersion: 's', sdkVersion: '0.3.0', sdkClaudeVersion: '2.1.0' },
      join(root, 'bin', 'shinsa')
    );
    const dataDir = join(createTempDir(), 'data');
    const stdout = process.stdout.write;
    const stderr = process.stderr.write;
    const path = process.env.PATH;
    const restore = overrideEnv({ [SERVICE_MARKER]: '1' });
    const log = join(dataDir, 'engine.log');
    const readLog = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
    try {
      await runProcessEngine(
        { isTerminal: () => true, bundle },
        { [SERVICE_MARKER]: '1', ...createInspectEnv(dataDir) },
        () => readLog().includes(INSPECT_READY)
      );
      expect(readLog()).toContain('[Serve] Started from a terminal');
      expect(process.env.PATH?.split(':')[0]).toBe(join(root, 'bin'));
    } finally {
      process.stdout.write = stdout;
      process.stderr.write = stderr;
      process.env.PATH = path;
      restore();
    }
  });
});

describe('the engine log', () => {
  test('writes output to the log file and trims a long one to its last half', () => {
    const dir = createTempDir();
    const path = join(dir, 'engine.log');
    writeFiles(dir, { 'engine.log': 'x'.repeat(100) });
    Effect.runSync(trimEngineLog(path, 40));
    expect(Bun.file(path).size).toBe(20);
    Effect.runSync(trimEngineLog(join(dir, 'missing.log'), 40));
    const stream = { write: (() => true) as NodeJS.WriteStream['write'] } as NodeJS.WriteStream;
    const close = Effect.runSync(writeOutputTo(path, [stream]));
    stream.write('hello\n');
    stream.write(new TextEncoder().encode('bytes\n'));
    close();
    expect(readFileSync(path, 'utf8').endsWith('hello\nbytes\n')).toBe(true);
  });
});

describe('managing Shinsa from the command line', () => {
  test('a group alone, or with help, lists its commands', async () => {
    for (const args of [['tasks'], ['tasks', '--help'], ['tasks', 'help'], ['tasks', 'launch', '-h']]) {
      const { io, out } = createIo('1');
      expect(await runCli(args, io)).toBe(0);
      expect(out[0]?.split('\n').slice(0, 7)).toEqual([
        'List, open and create tasks; message, retry, reprioritize, cancel or finish one.',
        '',
        'Usage',
        '  shinsa tasks <command> [arguments] [--json]',
        '',
        'Commands',
        `  ${'list'.padEnd(21)}List tasks, most recently changed first.`,
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
    expect(plain.errors).toEqual(['Error: No task nope.', '`shinsa tasks list` lists them.']);
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
        message: NOT_RUNNING,
      },
    });
    const invalid = createIo('1');
    expect(await runCli(['tasks', 'list', '--status', 'later', '--json'], invalid.io)).toBe(1);
    expect(JSON.parse(invalid.out[0] ?? '')).toMatchObject({ error: { code: 'arguments_invalid' } });
  });

  test('an unknown command in a group says how to see the group', async () => {
    const { io, errors } = createIo('1');
    expect(await runCli(['tasks', 'launch', 'now'], io)).toBe(1);
    expect(errors).toEqual([
      'Error: No command shinsa tasks launch.',
      'Run `shinsa tasks --help` for its commands.',
    ]);
    const typo = createIo('1');
    expect(await runCli(['tasks', 'lsit'], typo.io)).toBe(1);
    expect(typo.errors).toEqual([
      'Error: No command shinsa tasks lsit.',
      'Did you mean `shinsa tasks list`? Run `shinsa tasks --help` for its commands.',
    ]);
  });
});

describe('stopping on a signal', () => {
  test('exits 0 once stopped or once the deadline passes, so launchd leaves it stopped, and 1 when the stop fails', async () => {
    const logs = captureLogs();
    try {
      const stop = async (engine: Effect.Effect<never>, deadlineMs = 1000) => {
        const codes: number[] = [];
        const fiber = Effect.runFork(engine);
        await Effect.runPromise(Effect.yieldNow);
        await runCliEffect(stopEngineFiber(fiber, (code) => codes.push(code), deadlineMs));
        return codes;
      };
      expect(await stop(Effect.never)).toEqual([0]);
      expect(await stop(Effect.never.pipe(Effect.ensuring(Effect.sleep('80 millis'))), 20)).toEqual([0, 0]);
      expect(await stop(Effect.never.pipe(Effect.ensuring(Effect.die(new Error('log closed')))))).toEqual([
        1,
      ]);
      expect(logs.fieldsOf('[Serve] Stopping')).toHaveLength(3);
      expect(logs.fieldsOf('[Engine] Did not stop in time, so it exits anyway')).toEqual([
        { deadlineMs: 20 },
      ]);
      expect(logs.fieldsOf('[Engine] Could not stop cleanly')).toEqual([{ error: 'log closed' }]);
    } finally {
      logs.restore();
    }
  });
});
