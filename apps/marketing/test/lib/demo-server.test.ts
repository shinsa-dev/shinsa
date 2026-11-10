import { afterEach, describe, expect, jest, mock, spyOn, test } from 'bun:test';
import type { ChatEvent, UserCommand } from '@shinsa/core';
import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { Socket } from 'effect/socket';
import { DEMO_ACK_DELAY_MS } from '../../src/lib/demo-server/schema.ts';

await mock.module('../../src/lib/scene.ts', () => ({ createHomeScene: (now: number) => ({ scene: now }) }));
await mock.module('../../src/lib/demo-repo.ts', () => ({
  answerCodeRead: (taskId: string, name: string, params: URLSearchParams) =>
    name === 'refs' ? { taskId, ref: params.get('ref') } : null,
  recordFileWrite: (taskId: string, write: object) => ({ taskId, ...write, changed: true }),
}));
Object.defineProperty(globalThis, 'location', {
  value: new URL('http://demo.test/page'),
  configurable: true,
});

const { DemoTransport } = await import('../../src/lib/demo-server/transport.ts');
const { appendTranscript, createDemoSocket, onDemoCommand, openDemoSockets, resetTranscript } =
  await import('../../src/lib/demo-server/sockets.ts');

const transport = await Effect.runPromise(
  Effect.gen(function* () {
    return { fetch: yield* FetchHttpClient.Fetch, open: yield* Socket.WebSocketConstructor };
  }).pipe(Effect.provide(DemoTransport))
);

function listen(socket: EventTarget) {
  const seen: unknown[] = [];
  socket.addEventListener('open', () => seen.push('open'));
  socket.addEventListener('message', (event) => seen.push(JSON.parse(String((event as MessageEvent).data))));
  return seen;
}

const SAY: ChatEvent = { type: 'notice', text: 'Hello.' } as unknown as ChatEvent;

afterEach(() => {
  mock.restore();
  jest.useRealTimers();
});

describe('the demo fetch', () => {
  test('answers a code read from the sample repositories', async () => {
    const response = await transport.fetch('/api/tasks/task%201/refs?ref=main');
    expect(await response.json()).toEqual({ taskId: 'task 1', ref: 'main' });
  });

  test('refuses a read the samples do not have, as the engine would', async () => {
    const response = await transport.fetch(new Request('http://demo.test/api/tasks/t-1/history'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'demo', message: 'This page only shows samples.' },
    });
  });

  test('records a file write from the JSON the client sends', async () => {
    const response = await transport.fetch('/api/tasks/t-1/file', {
      method: 'POST',
      body: JSON.stringify({ path: 'a.ts', content: 'x', base: null }),
    });
    expect(await response.json()).toEqual({
      taskId: 't-1',
      path: 'a.ts',
      content: 'x',
      base: null,
      changed: true,
    });
  });

  test('hands everything outside the page’s /api/ to the network', async () => {
    const network = spyOn(globalThis, 'fetch').mockImplementation(
      (async () => new Response('elsewhere')) as unknown as typeof fetch
    );
    const other = await transport.fetch('https://app.shinsa.dev/api/session');
    const page = await transport.fetch('/favicon.svg');
    expect(await other.text()).toBe('elsewhere');
    expect(await page.text()).toBe('elsewhere');
    expect(network).toHaveBeenCalledTimes(2);
  });
});

describe('the demo socket', () => {
  test('opens a socket on another path with the browser’s WebSocket', () => {
    const native = globalThis.WebSocket;
    globalThis.WebSocket = class {
      readonly url: string;
      constructor(url: URL) {
        this.url = String(url);
      }
    } as unknown as typeof WebSocket;
    const opened = transport.open('ws://demo.test/api/share/s-1') as unknown as { url: string };
    globalThis.WebSocket = native;
    expect(opened.url).toBe('ws://demo.test/api/share/s-1');
  });

  test('opens with the scene, then acks a command and hands it to every listener', () => {
    jest.useFakeTimers();
    const socket = transport.open('ws://demo.test/ws') as unknown as ReturnType<typeof createDemoSocket>;
    const seen = listen(socket);
    openDemoSockets();
    openDemoSockets();
    expect(socket.readyState).toBe(1);
    expect(seen[0]).toBe('open');
    expect(seen[1]).toMatchObject({ type: 'state', state: { scene: expect.any(Number) } });
    expect(seen[2]).toMatchObject({ type: 'engine' });
    expect(seen).toHaveLength(3);

    const commands: UserCommand[] = [];
    const stop = onDemoCommand((command) => commands.push(command));
    const command = { type: 'task.prioritize', taskId: 't-1', priority: 'high' };
    socket.send(JSON.stringify({ type: 'command', id: 'c-1', command }));
    jest.advanceTimersByTime(DEMO_ACK_DELAY_MS);
    stop();
    socket.send(JSON.stringify({ type: 'command', id: 'c-2', command }));
    jest.advanceTimersByTime(DEMO_ACK_DELAY_MS);
    expect(commands).toEqual([command as unknown as UserCommand]);
    expect(seen.slice(3)).toEqual([
      { type: 'ack', id: 'c-1', error: null },
      { type: 'ack', id: 'c-2', error: null },
    ]);
    socket.close();
  });

  test('streams a run’s transcript only while it is watched', () => {
    const socket = createDemoSocket();
    const seen = listen(socket);
    appendTranscript('r-1', [SAY]);
    socket.send(JSON.stringify({ type: 'transcript.subscribe', runId: 'r-1' }));
    socket.send(JSON.stringify({ type: 'transcript.subscribe', runId: 'r-2' }));
    appendTranscript('r-1', [SAY]);
    resetTranscript('r-1');
    socket.send(JSON.stringify({ type: 'transcript.unsubscribe', runId: 'r-1' }));
    appendTranscript('r-1', [SAY]);
    resetTranscript('r-1');
    socket.send('not json');
    socket.send(new Uint8Array([1]));

    expect(seen).toMatchObject([
      { type: 'transcript', runId: 'r-1', start: 0, entries: [{ type: 'notice', text: 'Hello.' }] },
      { type: 'transcript', runId: 'r-2', start: 0, entries: [] },
      { type: 'transcript', runId: 'r-1', start: 1, entries: [{ type: 'notice' }] },
      { type: 'transcript', runId: 'r-1', start: 0, entries: [] },
    ]);
    expect(seen).toHaveLength(4);
    socket.close();
    expect(socket.readyState).toBe(3);
    openDemoSockets();
    expect(seen).toHaveLength(4);
  });
});
