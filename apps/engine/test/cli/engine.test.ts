import { afterEach, describe, expect, test } from 'bun:test';
import {
  describeDuration,
  ENGINE_STOPPED,
  type EngineIo,
  printVersion,
  readHealth,
  resolveCommandVersion,
  restartEngine,
  startEngine,
  stopEngine,
} from '../../src/cli/engine.ts';
import { resolveBundle } from '../../src/instance/index.ts';
import { NO_PROGRESS, PLAIN_DISPLAY } from '../../src/terminal/index.ts';
import { createStyle, UNICODE_SYMBOLS } from '../../src/terminal/style.ts';

const COLOR = { style: createStyle({ color: true, symbols: UNICODE_SYMBOLS }), width: 80 };

const TARGET = 'gui/501/studio.overclock.shinsa.engine';

interface FakeEngine {
  pid: number | null;
  version: string;
  restartWhenIdle: boolean;
}

const servers: { stop: (force: boolean) => void }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function resolveFakeHealth(engine: FakeEngine) {
  return {
    ok: true,
    seq: 3,
    problems: [],
    version: engine.version,
    commit: null,
    installPath: '/Applications/Shinsa.app/Contents/Resources/engine',
    pid: engine.pid,
    startedAt: 0,
    protocol: 3,
    busy: false,
    restart: null,
    dataDir: '/data',
    uptimeMs: 0,
  };
}

function startFakeEngine(initial: Partial<FakeEngine> = {}) {
  const engine: FakeEngine = { pid: 100, version: '0.0.0', restartWhenIdle: false, ...initial };
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === '/api/engine/restart') {
        if (!engine.restartWhenIdle) return Response.json({ restarting: false });
        engine.pid = (engine.pid ?? 0) + 1;
        return Response.json({ restarting: true });
      }
      if (engine.pid === null) return new Response('stopped', { status: 503 });
      return Response.json(resolveFakeHealth(engine));
    },
  });
  servers.push(server);
  return { engine, base: `http://127.0.0.1:${server.port}` };
}

function createEngineIo(base: string, engine: FakeEngine | null, overrides: Partial<EngineIo> = {}) {
  const out: string[] = [];
  const calls: string[][] = [];
  const progress: string[] = [];
  const io: EngineIo = {
    base,
    display: PLAIN_DISPLAY,
    startProgress: (text) => {
      progress.push(text);
      return { stop: () => progress.push('stopped') };
    },
    bundled: true,
    uid: 501,
    ownsJob: () => true,
    waitMs: 2000,
    write: (line = '') => out.push(line),
    launchctl: (args) => {
      calls.push(args);
      if (args[0] === 'print') return Promise.resolve({ ok: true, output: 'state = running' });
      if (engine && args[0] === 'kickstart') engine.pid = args[1] === '-k' ? (engine.pid ?? 0) + 1 : 200;
      if (engine && args[0] === 'kill') engine.pid = null;
      return Promise.resolve({ ok: true, output: '' });
    },
    ...overrides,
  };
  return { io, out, calls, progress };
}

describe('reading the engine', () => {
  test('answers the health of a running engine, and null for one that is down or failing', async () => {
    const { base } = startFakeEngine();
    expect((await readHealth(base))?.pid).toBe(100);
    const stopped = startFakeEngine({ pid: null });
    expect(await readHealth(stopped.base)).toBeNull();
    expect(await readHealth('http://127.0.0.1:1')).toBeNull();
  });
});

describe('shinsa start', () => {
  test('asks launchd to start the job and waits until the engine answers', async () => {
    const { engine, base } = startFakeEngine({ pid: null });
    const { io, out, calls, progress } = createEngineIo(base, engine);
    await startEngine(io);
    expect(calls).toEqual([
      ['print', TARGET],
      ['kickstart', TARGET],
    ]);
    expect(progress).toEqual(['Starting the engine', 'stopped']);
    expect(out).toEqual([
      expect.stringMatching(/^Started the engine in \d+(?:ms|\.\ds)\. Shinsa 0\.0\.0, pid 200\.$/),
    ]);
  });

  test('in a terminal the result is one line with a check mark and the details dimmed', async () => {
    const { engine, base } = startFakeEngine({ pid: null });
    const { io, out } = createEngineIo(base, engine, { display: COLOR, startProgress: () => NO_PROGRESS });
    await startEngine(io);
    expect(out).toHaveLength(1);
    expect(out[0]).toStartWith('\u001b[32m✔\u001b[39m Started the engine in ');
    expect(out[0]).toEndWith('. \u001b[2mShinsa 0.0.0, pid 200.\u001b[22m');
  });

  test('a running engine is left alone', async () => {
    const { engine, base } = startFakeEngine();
    const { io, out, calls } = createEngineIo(base, engine, { bundled: false });
    await startEngine(io);
    expect(calls).toEqual([]);
    expect(out).toEqual(['The engine is already running. Shinsa 0.0.0, pid 100.']);
  });

  test('refuses a shinsa outside the app, or an app that never set the engine up', async () => {
    const { base } = startFakeEngine({ pid: null });
    await expect(startEngine(createEngineIo(base, null, { bundled: false }).io)).rejects.toThrow(
      'This shinsa is not the one in the Shinsa app, so it does not start or stop the engine. From source, `bun dev` runs the engine and Ctrl-C stops it.'
    );
    const missing = createEngineIo(base, null, {
      launchctl: () => Promise.resolve({ ok: false, output: 'Could not find service' }),
    });
    await expect(startEngine(missing.io)).rejects.toThrow(
      'The engine is not set up yet. Open the Shinsa app once and it sets it up.'
    );
  });

  test('leaves alone an engine another copy of Shinsa runs, and never calls launchd past print', async () => {
    const { base } = startFakeEngine({ pid: 100 });
    const other = createEngineIo(
      base,
      { pid: 100, version: '0.0.0', restartWhenIdle: false },
      { ownsJob: () => false }
    );
    const message =
      'This shinsa is not the one inside the Shinsa app that runs your engine, so it leaves that engine alone. Use `shinsa` from your PATH, which the app keeps pointing at itself.';
    await expect(stopEngine(other.io)).rejects.toThrow(message);
    await expect(restartEngine(other.io, false)).rejects.toThrow(message);
    const stopped = startFakeEngine({ pid: null });
    const elsewhere = createEngineIo(stopped.base, null, { ownsJob: () => false });
    await expect(startEngine(elsewhere.io)).rejects.toThrow(message);
    expect([...other.calls, ...elsewhere.calls].every((call) => call[0] === 'print')).toBe(true);
  });

  test('says when launchd refuses, and when the engine never answers', async () => {
    const { base } = startFakeEngine({ pid: null });
    const refusing = createEngineIo(base, null, {
      launchctl: (args) =>
        Promise.resolve({ ok: args[0] === 'print', output: args[0] === 'print' ? '' : '  ' }),
    });
    await expect(startEngine(refusing.io)).rejects.toThrow('launchctl kickstart failed: no output');
    const silent = createEngineIo(base, null, { waitMs: 1000 });
    await expect(startEngine(silent.io)).rejects.toThrow(
      'The engine did not answer within 1 second. `shinsa logs` shows why.'
    );
    expect(silent.progress).toEqual(['Starting the engine', 'stopped']);
  });
});

describe('shinsa stop', () => {
  test('stops the job cleanly and waits until the engine is gone', async () => {
    const { engine, base } = startFakeEngine();
    const { io, out, calls } = createEngineIo(base, engine);
    await stopEngine(io);
    expect(calls).toEqual([
      ['print', TARGET],
      ['kill', 'SIGTERM', TARGET],
    ]);
    expect(out).toEqual([
      expect.stringMatching(
        /^Stopped the engine in \d+(?:ms|\.\ds)\. Runs it cut off resume when it starts again: `shinsa start`, the Shinsa app or any command that needs it\.$/
      ),
    ]);
  });

  test('an engine that is not running needs nothing, and one that will not stop is reported', async () => {
    const { base } = startFakeEngine({ pid: null });
    const idle = createEngineIo(base, null);
    await stopEngine(idle.io);
    expect(idle.out).toEqual(['The engine is not running.']);
    const running = startFakeEngine();
    const stuck = createEngineIo(running.base, null, { waitMs: 600 });
    await expect(stopEngine(stuck.io)).rejects.toThrow(
      'The engine is still stopping after 1 second. `shinsa logs` shows why.'
    );
  });
});

describe('shinsa restart', () => {
  test('restarts the job and waits for the new engine', async () => {
    const { engine, base } = startFakeEngine();
    const { io, out, calls } = createEngineIo(base, engine);
    await restartEngine(io, false);
    expect(calls).toEqual([
      ['print', TARGET],
      ['kickstart', '-k', TARGET],
    ]);
    expect(out).toEqual([
      expect.stringMatching(/^Restarted the engine in \d+(?:ms|\.\ds)\. Shinsa 0\.0\.0, pid 101\.$/),
    ]);
  });

  test('with --when-idle the engine restarts itself once no agent is mid-turn', async () => {
    const busy = startFakeEngine();
    const waiting = createEngineIo(busy.base, busy.engine);
    await restartEngine(waiting.io, true);
    expect(waiting.out).toEqual(['The engine restarts once no agent is mid-turn.']);
    const idle = startFakeEngine({ restartWhenIdle: true });
    const now = createEngineIo(idle.base, idle.engine);
    await restartEngine(now.io, true);
    expect(now.calls).toEqual([['print', TARGET]]);
    expect(now.out).toEqual([
      expect.stringMatching(/^Restarted the engine in \d+(?:ms|\.\ds)\. Shinsa 0\.0\.0, pid 101\.$/),
    ]);
    const stopped = startFakeEngine({ pid: null });
    await expect(restartEngine(createEngineIo(stopped.base, null).io, true)).rejects.toThrow(ENGINE_STOPPED);
  });
});

describe('shinsa version', () => {
  test('names this command’s version and the engine’s, or that the engine is not running', async () => {
    const { base } = startFakeEngine();
    const running = createEngineIo(base, null, { bundled: false });
    await printVersion(running.io, false);
    expect(running.out).toEqual(['Command  0.0.0', 'Engine   0.0.0, pid 100, protocol 3']);
    const down = createEngineIo('http://127.0.0.1:1', null);
    await printVersion(down.io, false);
    expect(down.out).toEqual(['Command  0.0.0', 'Engine   Not running']);
    const colored = createEngineIo('http://127.0.0.1:1', null, { display: COLOR });
    await printVersion(colored.io, false);
    expect(colored.out).toEqual([
      '\u001b[2mCommand\u001b[22m  0.0.0',
      '\u001b[2mEngine\u001b[22m   \u001b[31m●\u001b[39m Not running',
    ]);
  });

  test('says when the app’s engine runs another version, and prints both as JSON', async () => {
    const bundle = resolveBundle(
      {
        version: '0.5.0',
        commit: 'b'.repeat(40),
        stateVersion: 's',
        sdkVersion: '0.3.0',
        sdkClaudeVersion: '2.1.0',
      },
      '/Applications/Shinsa.app/Contents/Resources/engine/bin/shinsa'
    );
    expect(resolveCommandVersion(bundle)).toEqual({ version: '0.5.0', commit: 'b'.repeat(40) });
    expect(resolveCommandVersion()).toEqual({ version: '0.0.0', commit: null });
    const { base } = startFakeEngine({ version: '0.4.2' });
    const behind = createEngineIo(base, null);
    await printVersion(behind.io, false, bundle);
    expect(behind.out).toEqual([
      'Command  0.5.0 (bbbbbbb)',
      'Engine   0.4.2, pid 100, protocol 3',
      '',
      'The engine runs another version than the app carries. `shinsa restart` starts the app’s.',
    ]);
    const json = createEngineIo(base, null);
    await printVersion(json.io, true, bundle);
    expect(JSON.parse(json.out[0] ?? '')).toMatchObject({
      command: { version: '0.5.0' },
      engine: { version: '0.4.2', pid: 100 },
    });
  });
});

describe('durations', () => {
  test('under a second in milliseconds, longer in seconds with one decimal', () => {
    expect(describeDuration(-5)).toBe('0ms');
    expect(describeDuration(420.4)).toBe('420ms');
    expect(describeDuration(1250)).toBe('1.3s');
  });
});
