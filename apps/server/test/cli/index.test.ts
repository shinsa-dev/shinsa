import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import type { ModelCatalog } from '../../src/agents/index.ts';
import { Transcripts } from '../../src/agents/index.ts';
import { type CliIo, createProcessIo, runCli, USAGE } from '../../src/cli/index.ts';
import { startServer } from '../../src/http/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import type { Shinsa } from '../../src/serve.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import { createTempDir, createTestConfig, writeFiles } from '../helpers/index.ts';

const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

function startTestServer() {
  const config = createTestConfig();
  const engine = new Engine(new EventLog(config.databasePath));
  const http = startServer({
    engine,
    config,
    transcripts: new Transcripts(config.transcriptsDir),
    evidence: new EvidenceStore(config.evidenceDir),
    models: { list: () => Promise.resolve([]) } as unknown as ModelCatalog,
  });
  stops.push(http.stop);
  return { engine, port: String(http.server.port) };
}

function createIo(port: string, overrides: Partial<CliIo> = {}) {
  const out: string[] = [];
  const errors: string[] = [];
  const opened: string[] = [];
  const io: CliIo = {
    env: { SHINSA_PORT: port },
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
});

describe('shinsa do', () => {
  test('hands the request over from the current directory and prints the task link', async () => {
    const { engine, port } = startTestServer();
    const { io, out } = createIo(port);
    expect(await runCli(['do', 'fix', 'the', 'scroll', '--urgent', '--spec'], io)).toBe(0);
    const task = Object.values(engine.state.tasks)[0];
    expect(task).toMatchObject({
      intent: 'fix the scroll',
      priority: 'urgent',
      specFirst: true,
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
    expect(tasks.map((task) => [task.origin, task.specFirst, task.priority])).toEqual([
      ['/code/from-session', true, 'normal'],
      ['/code/elsewhere', true, 'high'],
    ]);
    expect(out[0]).toBe(`Imported ${path}`);
    expect(tasks[0]?.intent).toContain('What was asked first:\nBuild the importer');
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

  test('open opens Shinsa or one task', async () => {
    const { io, opened } = createIo('5180');
    await runCli(['open'], io);
    await runCli(['open', 'task/1'], io);
    expect(opened).toEqual(['http://127.0.0.1:5180', 'http://127.0.0.1:5180/tasks/task%2F1']);
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
      expect(io.openUrl('fail')).rejects.toThrow('open fail failed: cannot open');
      expect(await runCli(['help'])).toBe(0);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
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
      io.onShutdown(() => {
        attempts += 1;
        if (attempts === 1) return shinsa.stop();
        return Promise.reject(new Error('already stopped'));
      });
      process.emit('SIGTERM');
      await Bun.sleep(20);
      process.emit('SIGINT');
      await Bun.sleep(20);
      expect(attempts).toBe(2);
      expect(exit.mock.calls).toEqual([[0], [1]]);
    } finally {
      exit.mockRestore();
    }
  });
});
