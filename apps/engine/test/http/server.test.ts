import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AgentModel, applyStatePatch, type ServerMessage, serializeState } from '@shinsa/core';
import { type ModelSource, Transcripts } from '../../src/agents/index.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { type Launcher, startServer } from '../../src/http/index.ts';
import type { EngineRestarter } from '../../src/instance/index.ts';
import { log as logger } from '../../src/log/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import { createTempDir, createTestConfig, createTestOnboarding, until } from '../helpers/index.ts';

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

describe('a taken port', () => {
  test('names the port and where to change it, in the words the Mac app looks for', async () => {
    const other = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('other') });
    try {
      const port = other.port ?? 0;
      const attempt = start({ config: { port } });
      await expect(attempt).rejects.toThrow(`Is port ${port} in use?`);
      await expect(attempt).rejects.toThrow(/set another `port` in .*config\.json\./);
    } finally {
      void other.stop(true);
    }
  });

  test('passes any other failure to listen through unchanged', async () => {
    await expect(start({ config: { port: 70_000 } })).rejects.not.toThrow('in use');
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
    await until('the first state', () => client.messages.length === 3);
    expect(client.messages.map((message) => message.type)).toEqual(['surfaces', 'engine', 'state']);
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

  test('a page gets settled tasks as summaries and reads one in full when it asks', async () => {
    const { base, engine } = await start();
    await engine.dispatch({ type: 'task.create', request: 'Drop the old tabs', repoId: null });
    const taskId = Object.keys(engine.state.tasks)[0] ?? '';
    await engine.dispatch({ type: 'task.cancel', taskId });
    const client = connect(base);
    await client.opened;
    await until('the state', () => client.messages.some((message) => message.type === 'state'));
    const first = client.messages.find((message) => message.type === 'state');
    expect(first?.type === 'state' && first.state.tasks[taskId]?.summarized).toBe(true);
    client.socket.send(JSON.stringify({ type: 'task.detail', taskId }));
    await until('the detail', () => client.messages.some((message) => message.type === 'task.detail'));
    const detail = client.messages.find((message) => message.type === 'task.detail');
    expect(detail?.type === 'task.detail' && detail.detail.task).toEqual(
      JSON.parse(JSON.stringify(engine.state.tasks[taskId]))
    );
    client.socket.close();
  });

  test('a state over 16 MB still reaches the page with every connect message before it', async () => {
    const { base, engine } = await start();
    const request = 'x'.repeat(1024 * 1024);
    for (let index = 0; index < 17; index += 1) {
      await engine.dispatch({ type: 'task.create', request: `${index}${request}`, repoId: null });
    }
    expect(JSON.stringify(serializeState(engine.state)).length).toBeGreaterThan(16 * 1024 * 1024);
    const client = connect(base);
    await client.opened;
    await until('the state', () => client.messages.some((message) => message.type === 'state'));
    expect(client.messages.map((message) => message.type)).toEqual(['surfaces', 'engine', 'state']);
    client.socket.send(JSON.stringify({ type: 'hello', surface: 'browser' }));
    await engine.dispatch({ type: 'task.create', request: 'After the state', repoId: null });
    await until('a patch after the state', () =>
      client.messages.some((message) => message.type === 'state.patch')
    );
    client.socket.close();
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
      expect(client.messages.map((message) => message.type)).toEqual(['surfaces', 'engine', 'state']);
      client.socket.close();
    } finally {
      error.mockRestore();
      transcripts.readEntries = original;
    }
  });
});
