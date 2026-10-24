import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { ChatEntry, ClientMessage, ServerMessage, UserCommand } from '@shinsa/core';
import { act, renderHook } from '@testing-library/react';
import {
  Connection,
  connection,
  sendCommand,
  useConnection,
  useTranscript,
} from '@/lib/connection/socket.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

class FakeSocket extends EventTarget {
  readyState = 0;
  readonly sent: ClientMessage[] = [];

  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }

  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }

  receive(message: ServerMessage) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

const COMMAND: UserCommand = { type: 'task.retry', taskId: 't1' };

function entry(id: string): ChatEntry {
  return { id, kind: 'note', text: id } as unknown as ChatEntry;
}

function setup() {
  const sockets: FakeSocket[] = [];
  const retries: { reconnect: () => void; delayMs: number }[] = [];
  const subject = new Connection({
    openSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    retry: (reconnect, delayMs) => {
      retries.push({ reconnect, delayMs });
    },
  });
  const latest = () => {
    const socket = sockets.at(-1);
    if (!socket) throw new Error('No socket was opened.');
    return socket;
  };
  return { subject, sockets, retries, latest };
}

function commandIds(socket: FakeSocket) {
  return socket.sent.flatMap((message) => (message.type === 'command' ? [message.id] : []));
}

describe('Connection', () => {
  it('starts connecting with no state', () => {
    const { subject } = setup();
    expect(subject.snapshot()).toEqual({ state: null, status: 'connecting' });
  });

  it('opens one socket however often it is started', () => {
    const { subject, sockets, latest } = setup();
    subject.start();
    subject.start();
    latest().open();
    subject.start();
    expect(sockets).toHaveLength(1);
  });

  it('does not open a second socket while a reconnect is pending', () => {
    const { subject, sockets, latest } = setup();
    subject.start();
    latest().close();
    subject.start();
    expect(sockets).toHaveLength(1);
  });

  it('publishes the status and each state the server sends', () => {
    const { subject, latest } = setup();
    const listener = mock(() => {});
    subject.subscribe(listener);
    subject.start();
    latest().open();
    expect(subject.snapshot().status).toBe('open');
    const state = createShinsaState({ tasks: [createTask({ id: 't1' })] });
    latest().receive({ type: 'state', state });
    expect(subject.snapshot()).toEqual({ state, status: 'open' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps the last state through a disconnect', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    const state = createShinsaState({});
    latest().receive({ type: 'state', state });
    latest().close();
    expect(subject.snapshot()).toEqual({ state, status: 'closed' });
  });

  it('rejects a command while not connected', async () => {
    const { subject, latest } = setup();
    await expect(subject.command(COMMAND)).rejects.toThrow('Not connected to Shinsa.');
    subject.start();
    await expect(subject.command(COMMAND)).rejects.toThrow('Not connected to Shinsa.');
    expect(latest().sent).toEqual([]);
  });

  it('sends a command and resolves it when the server acknowledges it', async () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    const sent = subject.command(COMMAND);
    const [id = ''] = commandIds(latest());
    expect(latest().sent).toEqual([{ type: 'command', id, command: COMMAND }]);
    latest().receive({ type: 'ack', id, error: null });
    await expect(sent).resolves.toBeUndefined();
  });

  it('settles each command by its own acknowledgement, in any order', async () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    const first = subject.command(COMMAND);
    const second = subject.command({ type: 'task.cancel', taskId: 't2' });
    const [firstId = '', secondId = ''] = commandIds(latest());
    latest().receive({
      type: 'ack',
      id: secondId,
      error: { code: 'task_settled', message: 'This task is finished.' },
    });
    latest().receive({ type: 'ack', id: firstId, error: null });
    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toThrow('This task is finished.');
  });

  it('ignores an acknowledgement for a command it does not know', async () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    const sent = subject.command(COMMAND);
    const [id = ''] = commandIds(latest());
    latest().receive({ type: 'ack', id: 'unknown', error: null });
    latest().receive({ type: 'ack', id, error: null });
    latest().receive({ type: 'ack', id, error: { code: 'late', message: 'Too late.' } });
    await expect(sent).resolves.toBeUndefined();
  });

  it('resends a command still waiting after a reconnect, under the same id so Shinsa applies it once', async () => {
    const { subject, retries, latest } = setup();
    subject.start();
    latest().open();
    const sent = subject.command(COMMAND);
    const [id = ''] = commandIds(latest());
    latest().close();
    retries.at(-1)?.reconnect();
    latest().open();
    expect(latest().sent).toEqual([{ type: 'command', id, command: COMMAND }]);
    latest().receive({ type: 'ack', id, error: null });
    await expect(sent).resolves.toBeUndefined();
  });

  it('gives up on a command once the connection has dropped three times under it', async () => {
    const { subject, retries, latest } = setup();
    subject.start();
    latest().open();
    const sent = subject.command(COMMAND);
    const [id = ''] = commandIds(latest());
    latest().close();
    retries.at(-1)?.reconnect();
    latest().close();
    retries.at(-1)?.reconnect();
    latest().close();
    await expect(sent).rejects.toThrow('Lost the connection to Shinsa.');
    retries.at(-1)?.reconnect();
    latest().open();
    expect(latest().sent).toEqual([]);
    latest().receive({ type: 'ack', id, error: null });
  });

  it('backs off between reconnects and resets once a socket opens', () => {
    const { subject, sockets, retries, latest } = setup();
    subject.start();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      latest().close();
      retries.at(-1)?.reconnect();
    }
    expect(retries.map((retry) => retry.delayMs)).toEqual([250, 1000, 2000, 5000, 5000]);
    expect(sockets).toHaveLength(6);
    latest().open();
    latest().close();
    expect(retries.at(-1)?.delayMs).toBe(250);
    expect(subject.snapshot().status).toBe('closed');
  });

  it('sends commands on the new socket after a reconnect', async () => {
    const { subject, sockets, retries, latest } = setup();
    subject.start();
    latest().open();
    latest().close();
    retries.at(-1)?.reconnect();
    latest().open();
    const sent = subject.command(COMMAND);
    const [id = ''] = commandIds(latest());
    expect(sockets[0]?.sent).toEqual([]);
    latest().receive({ type: 'ack', id, error: null });
    await expect(sent).resolves.toBeUndefined();
  });
});

describe('Connection transcripts', () => {
  it('subscribes to a run once however many watchers it has', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    const releaseFirst = subject.watchTranscript('r1');
    const releaseSecond = subject.watchTranscript('r1');
    expect(latest().sent).toEqual([{ type: 'transcript.subscribe', runId: 'r1' }]);
    releaseFirst();
    expect(latest().sent).toHaveLength(1);
    releaseSecond();
    expect(latest().sent).toEqual([
      { type: 'transcript.subscribe', runId: 'r1' },
      { type: 'transcript.unsubscribe', runId: 'r1' },
    ]);
  });

  it('releasing the same watch twice leaves the other watcher subscribed', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    const release = subject.watchTranscript('r1');
    subject.watchTranscript('r1');
    release();
    release();
    expect(latest().sent).toEqual([{ type: 'transcript.subscribe', runId: 'r1' }]);
  });

  it('ignores a message from the server that is not JSON', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    latest().dispatchEvent(new MessageEvent('message', { data: 'not json' }));
    latest().receive({ type: 'state', state: createShinsaState({}) });
    expect(subject.snapshot().state).not.toBeNull();
  });

  it('subscribes runs watched before the socket opened once it opens', () => {
    const { subject, latest } = setup();
    subject.watchTranscript('r1');
    subject.start();
    expect(latest().sent).toEqual([]);
    latest().open();
    expect(latest().sent).toEqual([{ type: 'transcript.subscribe', runId: 'r1' }]);
  });

  it('re-subscribes open transcripts after a reconnect, and not released ones', () => {
    const { subject, retries, latest } = setup();
    subject.start();
    latest().open();
    subject.watchTranscript('r1');
    const release = subject.watchTranscript('r2');
    release();
    latest().close();
    retries.at(-1)?.reconnect();
    latest().open();
    expect(latest().sent).toEqual([{ type: 'transcript.subscribe', runId: 'r1' }]);
  });

  it('appends entries and replaces them on a reset', () => {
    const { subject, latest } = setup();
    const listener = mock(() => {});
    subject.subscribeTranscripts(listener);
    subject.start();
    latest().open();
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('a')], reset: false });
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('b')], reset: false });
    expect(subject.selectTranscript('r1')).toEqual([entry('a'), entry('b')]);
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('c')], reset: true });
    expect(subject.selectTranscript('r1')).toEqual([entry('c')]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('keeps transcripts of different runs apart', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('a')], reset: true });
    latest().receive({ type: 'transcript', runId: 'r2', entries: [entry('b')], reset: true });
    expect(subject.selectTranscript('r1')).toEqual([entry('a')]);
    expect(subject.selectTranscript('r2')).toEqual([entry('b')]);
  });

  it('returns the same empty list for a run it has nothing for', () => {
    const { subject } = setup();
    expect(subject.selectTranscript('r1')).toEqual([]);
    expect(subject.selectTranscript('r1')).toBe(subject.selectTranscript('r2'));
  });
});

describe('the shared connection', () => {
  const RealWebSocket = globalThis.WebSocket;

  afterEach(() => {
    globalThis.WebSocket = RealWebSocket;
  });

  it('opens a WebSocket to /ws on this host and retries it after a delay', () => {
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    globalThis.WebSocket = class extends FakeSocket {
      static readonly OPEN = 1;
      constructor(url: string) {
        super();
        urls.push(url);
        sockets.push(this);
      }
    } as unknown as typeof WebSocket;
    const timers: { run: () => void; delayMs: number | undefined }[] = [];
    const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(((
      run: () => void,
      delayMs?: number
    ) => {
      timers.push({ run, delayMs });
      return 0;
    }) as unknown as typeof setTimeout);
    const subject = new Connection();
    subject.start();
    expect(urls).toEqual(['ws://localhost/ws']);
    sockets[0]?.close();
    expect(timers.map((timer) => timer.delayMs)).toEqual([250]);
    timers[0]?.run();
    expect(urls).toHaveLength(2);
    timeout.mockRestore();
  });

  it('sends commands through the shared connection', async () => {
    const command = spyOn(connection, 'command').mockResolvedValue(undefined);
    await sendCommand(COMMAND);
    expect(command).toHaveBeenCalledWith(COMMAND);
    command.mockRestore();
  });

  it('useConnection follows the shared snapshot', () => {
    let current = { state: null, status: 'connecting' as const };
    let notify = () => {};
    const subscribe = spyOn(connection, 'subscribe').mockImplementation((listener) => {
      notify = listener;
      return () => {};
    });
    const snapshot = spyOn(connection, 'snapshot').mockImplementation(() => current);
    const { result } = renderHook(() => useConnection());
    expect(result.current.status).toBe('connecting');
    act(() => {
      current = { ...current, status: 'open' as 'connecting' };
      notify();
    });
    expect(result.current.status).toBe('open');
    subscribe.mockRestore();
    snapshot.mockRestore();
  });

  it('useTranscript watches the run while mounted and releases it after', () => {
    const release = mock(() => {});
    const watch = spyOn(connection, 'watchTranscript').mockReturnValue(release);
    const select = spyOn(connection, 'selectTranscript').mockReturnValue([entry('a')]);
    const { result, rerender, unmount } = renderHook(({ runId }) => useTranscript(runId), {
      initialProps: { runId: 'r1' as string | null },
    });
    expect(result.current).toEqual([entry('a')]);
    expect(watch).toHaveBeenCalledWith('r1');
    rerender({ runId: 'r2' });
    expect(release).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenLastCalledWith('r2');
    unmount();
    expect(release).toHaveBeenCalledTimes(2);
    watch.mockRestore();
    select.mockRestore();
  });

  it('useTranscript returns nothing and watches nothing without a run', () => {
    const watch = spyOn(connection, 'watchTranscript');
    const { result } = renderHook(() => useTranscript(null));
    expect(result.current).toEqual([]);
    expect(watch).not.toHaveBeenCalled();
    watch.mockRestore();
  });
});
