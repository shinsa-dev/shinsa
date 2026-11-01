import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import {
  type ChatEntry,
  type ClientMessage,
  decide,
  NO_TEAM_FEED,
  resolveStatePatch,
  type ServerMessage,
  type ShinsaState,
  type UserCommand,
} from '@shinsa/core';
import { act, renderHook } from '@testing-library/react';
import {
  Connection,
  connection,
  replaceConnection,
  sendCommand,
  TRANSCRIPT_CACHE_LIMIT,
  TRANSCRIPT_ENTRY_LIMIT,
  useConnection,
  useDesktopConnected,
  useMachine,
  useMachineAccess,
  useMachines,
  useTranscript,
  useUnreachableMachines,
} from '@/lib/connection/socket.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { createShinsaState, createTask } from '../../support/state.ts';
import { createTerminal, createTerminalsSnapshot } from '../../support/terminals.ts';

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

const HELLO: ClientMessage = { type: 'hello', surface: 'browser' };

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
    schedule: (flush) => flush(),
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
    expect(latest().sent).toEqual([HELLO, { type: 'command', id, command: COMMAND }]);
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
    expect(latest().sent).toEqual([HELLO, { type: 'command', id, command: COMMAND }]);
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
    expect(latest().sent).toEqual([HELLO]);
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
    expect(sockets[0]?.sent).toEqual([HELLO]);
    latest().receive({ type: 'ack', id, error: null });
    await expect(sent).resolves.toBeUndefined();
  });
});

describe('Connection state', () => {
  function seeded(seq = 4) {
    return createShinsaState({
      tasks: [createTask({ id: 't1', stage: 'triage', priority: 'normal' })],
      patch: { seq },
    });
  }

  function patchFor(state: ShinsaState, command: UserCommand) {
    const decision = decide(state, command, { now: 10, newId: () => 'n1' });
    return { next: decision.state, patch: resolveStatePatch(state, decision.state, decision.changes) };
  }

  it('applies each patch to the state it has, and keeps every entry the patch leaves alone', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    const state = createShinsaState({
      tasks: [createTask({ id: 't1', stage: 'triage' }), createTask({ id: 't2', stage: 'triage' })],
      patch: { seq: 4 },
    });
    latest().receive({ type: 'state', state });
    const before = subject.snapshot().state;
    const { next, patch } = patchFor(state, { type: 'task.prioritize', taskId: 't1', priority: 'high' });
    latest().receive({ type: 'state.patch', patch });
    const after = subject.snapshot().state;
    expect(after?.tasks.t1?.priority).toBe('high');
    expect(after?.seq).toBe(next.seq);
    expect(after?.tasks.t2).toBe(before?.tasks.t2);
  });

  it('skips a patch it already has, asks for the whole state after a gap, and waits for it', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    latest().receive({ type: 'state.patch', patch: { from: 0, to: 1, fields: {}, records: {} } });
    expect(subject.snapshot().state).toBeNull();
    const state = seeded();
    latest().receive({ type: 'state', state });
    latest().receive({ type: 'state.patch', patch: { from: 3, to: 4, fields: {}, records: {} } });
    expect(subject.snapshot().state).toEqual(state);
    latest().receive({ type: 'state.patch', patch: { from: 6, to: 7, fields: {}, records: {} } });
    expect(latest().sent.at(-1)).toEqual({ type: 'state.sync' });
    latest().receive({ type: 'state.patch', patch: { from: 4, to: 5, fields: {}, records: {} } });
    expect(subject.snapshot().state?.seq).toBe(4);
    const fresh = seeded(7);
    latest().receive({ type: 'state', state: fresh });
    expect(subject.snapshot().state).toEqual(fresh);
  });

  it('applies a patch that changes the state without a new event, such as a new Home guide', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    const state = seeded();
    latest().receive({ type: 'state', state });
    const stored = { text: 'Nothing needs you right now.', at: 9, briefing: null };
    const guide = {
      from: state.seq,
      to: state.seq,
      fields: {},
      records: { briefings: { '*': { put: stored } } },
    };
    latest().receive({ type: 'state.patch', patch: guide });
    expect(subject.snapshot().state?.briefings['*']).toEqual(stored);
    expect(subject.snapshot().state?.seq).toBe(state.seq);
    expect(latest().sent.at(-1)).not.toEqual({ type: 'state.sync' });
  });

  it('applies what arrives within a frame once, on the next frame', () => {
    const frames: (() => void)[] = [];
    const sockets: FakeSocket[] = [];
    const subject = new Connection({
      openSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      retry: () => undefined,
      schedule: (flush) => {
        frames.push(flush);
      },
    });
    const listener = mock(() => {});
    subject.subscribe(listener);
    subject.start();
    sockets[0]?.open();
    const state = seeded();
    sockets[0]?.receive({ type: 'state', state });
    const { patch } = patchFor(state, { type: 'task.prioritize', taskId: 't1', priority: 'high' });
    sockets[0]?.receive({ type: 'state.patch', patch });
    sockets[0]?.receive({ type: 'transcript', runId: 'r1', entries: [entry('a')], start: 0 });
    expect(frames).toHaveLength(1);
    expect(subject.snapshot().state).toBeNull();
    const calls = listener.mock.calls.length;
    frames[0]?.();
    frames[0]?.();
    expect(subject.snapshot().state?.tasks.t1?.priority).toBe('high');
    expect(subject.selectTranscript('r1')).toEqual([entry('a')]);
    expect(listener.mock.calls.length).toBe(calls + 1);
  });

  it('shows a safe command at once, keeps it through the server’s change, and drops it on the answer', async () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    const state = seeded();
    latest().receive({ type: 'state', state });
    const command: UserCommand = { type: 'task.prioritize', taskId: 't1', priority: 'urgent' };
    const sent = subject.command(command);
    expect(subject.snapshot().state?.tasks.t1?.priority).toBe('urgent');
    const [id = ''] = commandIds(latest());
    const { patch } = patchFor(state, command);
    latest().receive({ type: 'state.patch', patch });
    expect(subject.snapshot().state?.tasks.t1?.priority).toBe('urgent');
    latest().receive({ type: 'ack', id, error: null });
    await sent;
    expect(subject.snapshot().state?.tasks.t1?.priority).toBe('urgent');
    expect(subject.snapshot().state?.seq).toBe(patch.to);
  });

  it('takes a safe command back when the server refuses it or the connection is lost under it', async () => {
    const { subject, retries, latest } = setup();
    subject.start();
    latest().open();
    latest().receive({ type: 'state', state: seeded() });
    const refused = subject.command({ type: 'task.prioritize', taskId: 't1', priority: 'low' });
    expect(subject.snapshot().state?.tasks.t1?.priority).toBe('low');
    const [id = ''] = commandIds(latest());
    latest().receive({ type: 'ack', id, error: { code: 'nope', message: 'No.' } });
    await expect(refused).rejects.toThrow('No.');
    expect(subject.snapshot().state?.tasks.t1?.priority).toBe('normal');
    const lost = subject.command({ type: 'task.prioritize', taskId: 't1', priority: 'high' });
    for (let drop = 0; drop < 3; drop += 1) {
      latest().close();
      retries.at(-1)?.reconnect();
      latest().open();
    }
    await expect(lost).rejects.toThrow('Lost the connection to Shinsa.');
    expect(subject.snapshot().state?.tasks.t1?.priority).toBe('normal');
  });

  it('sends other commands without guessing their outcome, and a safe one before any state as it is', async () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    const early = subject.command({ type: 'task.prioritize', taskId: 't1', priority: 'high' });
    expect(subject.snapshot().state).toBeNull();
    const state = seeded();
    latest().receive({ type: 'state', state });
    const listener = mock(() => {});
    subject.subscribe(listener);
    const other = subject.command({ type: 'task.create', request: 'Later', repoId: null });
    expect(listener).not.toHaveBeenCalled();
    for (const id of commandIds(latest())) latest().receive({ type: 'ack', id, error: null });
    await Promise.all([early, other]);
  });
});

describe('the frame the connection waits for', () => {
  it('is the next animation frame, or a short timer when the page is hidden and frames stop', () => {
    const frames: FrameRequestCallback[] = [];
    const animation = spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return 1;
    });
    const timers: (() => void)[] = [];
    const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(((run: () => void) => {
      timers.push(run);
      return 0;
    }) as unknown as typeof setTimeout);
    const sockets: FakeSocket[] = [];
    const subject = new Connection({
      openSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      retry: () => undefined,
    });
    subject.start();
    sockets[0]?.open();
    const first = createShinsaState({ patch: { seq: 1 } });
    sockets[0]?.receive({ type: 'state', state: first });
    frames[0]?.(0);
    expect(subject.snapshot().state).toEqual(first);
    timers[0]?.();
    const second = createShinsaState({ patch: { seq: 2 } });
    sockets[0]?.receive({ type: 'state', state: second });
    timers[1]?.();
    expect(subject.snapshot().state).toEqual(second);
    animation.mockRestore();
    timeout.mockRestore();
  });
});

describe('Connection surfaces', () => {
  it('says which surface it is before anything else, on every socket', () => {
    const { subject, retries, latest } = setup();
    subject.watchTranscript('r1');
    subject.start();
    latest().open();
    expect(latest().sent[0]).toEqual(HELLO);
    latest().close();
    retries.at(-1)?.reconnect();
    latest().open();
    expect(latest().sent[0]).toEqual(HELLO);
  });

  it('says it is the desktop app when its surface is', () => {
    const sockets: FakeSocket[] = [];
    const subject = new Connection({
      openSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      retry: () => undefined,
      surface: () => 'desktop',
    });
    subject.start();
    sockets[0]?.open();
    expect(sockets[0]?.sent).toEqual([{ type: 'hello', surface: 'desktop' }]);
  });

  it('follows whether the desktop app is connected, as the server says', () => {
    const { subject, latest } = setup();
    const listener = mock(() => {});
    subject.subscribeSurfaces(listener);
    subject.start();
    latest().open();
    expect(subject.isDesktopConnected()).toBe(false);
    latest().receive({ type: 'surfaces', desktop: true });
    expect(subject.isDesktopConnected()).toBe(true);
    latest().receive({ type: 'surfaces', desktop: false });
    expect(subject.isDesktopConnected()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('Connection terminals', () => {
  it('keeps the terminals the server pushes and tells its listeners', () => {
    const { subject, latest } = setup();
    const listener = mock(() => undefined);
    subject.subscribeTerminals(listener);
    subject.start();
    latest().open();
    expect(subject.selectTerminals()).toBeNull();
    const terminals = createTerminalsSnapshot([createTerminal({ id: 'one' })]);
    latest().receive({ type: 'terminals', terminals });
    expect(subject.selectTerminals()).toEqual(terminals);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('Connection remote access', () => {
  it('keeps the remote access the server pushes, tells its listeners and forgets it on reset', () => {
    const { subject, latest } = setup();
    const listener = mock(() => undefined);
    subject.subscribeRemote(listener);
    subject.start();
    latest().open();
    expect(subject.selectRemote()).toBeNull();
    const remote = createRemoteSnapshot();
    latest().receive({ type: 'remote', remote });
    expect(subject.selectRemote()).toEqual(remote);
    expect(listener).toHaveBeenCalledTimes(1);
    subject.reset();
    expect(subject.selectRemote()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('Connection team feeds', () => {
  it('keeps the teammates’ task lists the engine pushes, tells its listeners and forgets them on reset', () => {
    const { subject, latest } = setup();
    const listener = mock(() => undefined);
    subject.subscribeTeams(listener);
    subject.start();
    latest().open();
    expect(subject.selectTeams()).toBe(NO_TEAM_FEED);
    const teams = { machines: [], tasks: [] };
    latest().receive({ type: 'teams', teams });
    expect(subject.selectTeams()).toEqual(teams);
    expect(listener).toHaveBeenCalledTimes(1);
    subject.reset();
    expect(subject.selectTeams()).toBe(NO_TEAM_FEED);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('Connection transcripts', () => {
  it('subscribes to a run once however many watchers it has', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    const releaseFirst = subject.watchTranscript('r1');
    const releaseSecond = subject.watchTranscript('r1');
    expect(latest().sent).toEqual([HELLO, { type: 'transcript.subscribe', runId: 'r1', from: 0 }]);
    releaseFirst();
    expect(latest().sent).toHaveLength(2);
    releaseSecond();
    expect(latest().sent).toEqual([
      HELLO,
      { type: 'transcript.subscribe', runId: 'r1', from: 0 },
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
    expect(latest().sent).toEqual([HELLO, { type: 'transcript.subscribe', runId: 'r1', from: 0 }]);
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
    expect(latest().sent).toEqual([HELLO, { type: 'transcript.subscribe', runId: 'r1', from: 0 }]);
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
    expect(latest().sent).toEqual([HELLO, { type: 'transcript.subscribe', runId: 'r1', from: 0 }]);
  });

  it('appends entries where they belong and replaces them when the server starts over', () => {
    const { subject, latest } = setup();
    const listener = mock(() => {});
    subject.subscribeTranscripts(listener);
    subject.start();
    latest().open();
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('a')], start: 0 });
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('b')], start: 1 });
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('b'), entry('c')], start: 1 });
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('a')], start: 0 });
    expect(subject.selectTranscript('r1')).toEqual([entry('a')]);
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('b')], start: 1 });
    const kept = subject.selectTranscript('r1');
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('b')], start: 1 });
    expect(subject.selectTranscript('r1')).toBe(kept);
    expect(listener).toHaveBeenCalledTimes(6);
  });

  it('asks again from where it is when entries arrive with a gap before them', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    subject.watchTranscript('r1');
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('a')], start: 0 });
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('d')], start: 3 });
    expect(subject.selectTranscript('r1')).toEqual([entry('a')]);
    expect(latest().sent.at(-1)).toEqual({ type: 'transcript.subscribe', runId: 'r1', from: 1 });
  });

  it('asks only for the entries it does not have after a reconnect', () => {
    const { subject, retries, latest } = setup();
    subject.start();
    latest().open();
    subject.watchTranscript('r1');
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('a'), entry('b')], start: 0 });
    latest().close();
    retries.at(-1)?.reconnect();
    latest().open();
    expect(latest().sent).toEqual([HELLO, { type: 'transcript.subscribe', runId: 'r1', from: 2 }]);
  });

  it('keeps transcripts of different runs apart', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('a')], start: 0 });
    latest().receive({ type: 'transcript', runId: 'r2', entries: [entry('b')], start: 0 });
    expect(subject.selectTranscript('r1')).toEqual([entry('a')]);
    expect(subject.selectTranscript('r2')).toEqual([entry('b')]);
  });

  it('drops the transcripts read longest ago past its limit, never a watched one', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    subject.watchTranscript('watched');
    latest().receive({ type: 'transcript', runId: 'watched', entries: [entry('w')], start: 0 });
    for (let index = 0; index < TRANSCRIPT_CACHE_LIMIT; index += 1) {
      latest().receive({ type: 'transcript', runId: `r${index}`, entries: [entry('a')], start: 0 });
    }
    expect(subject.selectTranscript('watched')).toEqual([entry('w')]);
    expect(subject.selectTranscript('r0')).toEqual([]);
    expect(subject.selectTranscript('r1')).toEqual([entry('a')]);
  });

  it('drops the transcripts read longest ago once they hold too many entries, never a watched one', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    const half = Array.from({ length: TRANSCRIPT_ENTRY_LIMIT / 2 }, (_, index) => entry(`e${index}`));
    subject.watchTranscript('watched');
    latest().receive({ type: 'transcript', runId: 'watched', entries: half, start: 0 });
    latest().receive({ type: 'transcript', runId: 'old', entries: half.slice(1), start: 0 });
    latest().receive({ type: 'transcript', runId: 'new', entries: [entry('n')], start: 0 });
    expect(subject.selectTranscript('watched')).toHaveLength(TRANSCRIPT_ENTRY_LIMIT / 2);
    expect(subject.selectTranscript('old')).toHaveLength(TRANSCRIPT_ENTRY_LIMIT / 2 - 1);
    latest().receive({ type: 'transcript', runId: 'newer', entries: [entry('m')], start: 0 });
    expect(subject.selectTranscript('old')).toEqual([]);
    expect(subject.selectTranscript('watched')).toHaveLength(TRANSCRIPT_ENTRY_LIMIT / 2);
    expect(subject.selectTranscript('new')).toEqual([entry('n')]);
    expect(subject.selectTranscript('newer')).toEqual([entry('m')]);
  });

  it('counts a released transcript as read last, so it outlives older ones', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    latest().receive({ type: 'transcript', runId: 'first', entries: [entry('f')], start: 0 });
    for (let index = 1; index < TRANSCRIPT_CACHE_LIMIT; index += 1) {
      latest().receive({ type: 'transcript', runId: `r${index}`, entries: [entry('a')], start: 0 });
    }
    subject.watchTranscript('first')();
    latest().receive({ type: 'transcript', runId: 'last', entries: [entry('l')], start: 0 });
    expect(subject.selectTranscript('first')).toEqual([entry('f')]);
    expect(subject.selectTranscript('r1')).toEqual([]);
    expect(subject.selectTranscript('last')).toEqual([entry('l')]);
  });

  it('keeps every watched transcript even past its limit', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    for (let index = 0; index <= TRANSCRIPT_CACHE_LIMIT; index += 1) {
      subject.watchTranscript(`r${index}`);
      latest().receive({ type: 'transcript', runId: `r${index}`, entries: [entry('a')], start: 0 });
    }
    expect(subject.selectTranscript('r0')).toEqual([entry('a')]);
    expect(subject.selectTranscript(`r${TRANSCRIPT_CACHE_LIMIT}`)).toEqual([entry('a')]);
  });

  it('drops entries with a gap for a run nobody watches instead of asking again', () => {
    const { subject, latest } = setup();
    subject.start();
    latest().open();
    latest().receive({ type: 'transcript', runId: 'r1', entries: [entry('d')], start: 3 });
    expect(subject.selectTranscript('r1')).toEqual([]);
    expect(latest().sent).toEqual([HELLO]);
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

  it('uses the connection a remote page put in place, with the machine of each task, until it is taken away', () => {
    const local = connection;
    const machine = { id: 'm2', name: 'Laptop', current: false };
    const machines = [
      { id: 'm2', name: 'Laptop', current: false, state: { tasks: {}, projects: {}, settings: {} } },
    ];
    expect(renderHook(() => useMachines()).result.current).toEqual([]);
    expect(renderHook(() => useUnreachableMachines()).result.current).toEqual([]);
    expect(renderHook(() => useMachineAccess()).result.current).toEqual([]);
    const unreachable = [{ id: 'm3', name: 'Build box' }];
    const access = [{ id: 'm2', name: 'Laptop', remote: null }];
    const fleet = {
      ...local,
      listUnreachableMachines: () => unreachable,
      listMachineAccess: () => access,
      selectMachine: (id: string) => (id === 'task-1' ? machine : null),
      listMachines: () => machines,
    };
    replaceConnection(fleet);
    expect(connection).toBe(fleet);
    expect(renderHook(() => useMachines()).result.current).toBe(machines);
    expect(renderHook(() => useUnreachableMachines()).result.current).toBe(unreachable);
    expect(renderHook(() => useMachineAccess()).result.current).toBe(access);
    expect(renderHook(() => useMachine('task-1')).result.current).toBe(machine);
    expect(renderHook(() => useMachine(null)).result.current).toBeNull();
    replaceConnection(null);
    expect(connection).toBe(local);
    expect(connection.selectMachine('task-1')).toBeNull();
  });

  it('sends commands through the shared connection', async () => {
    const command = spyOn(connection, 'command').mockResolvedValue(undefined);
    await sendCommand(COMMAND);
    expect(command).toHaveBeenCalledWith(COMMAND, undefined);
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

  it('useDesktopConnected follows the shared connection', () => {
    let current = false;
    let notify = () => {};
    const subscribe = spyOn(connection, 'subscribeSurfaces').mockImplementation((listener) => {
      notify = listener;
      return () => {};
    });
    const select = spyOn(connection, 'isDesktopConnected').mockImplementation(() => current);
    const { result } = renderHook(() => useDesktopConnected());
    expect(result.current).toBe(false);
    act(() => {
      current = true;
      notify();
    });
    expect(result.current).toBe(true);
    subscribe.mockRestore();
    select.mockRestore();
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
