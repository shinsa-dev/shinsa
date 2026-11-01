import { describe, expect, it } from 'bun:test';
import { type ShareMessage, serializeShareMessage } from '@shinsa/core';
import { waitFor } from '@testing-library/react';
import { UNREADABLE_MESSAGE } from '@/lib/share/live.ts';
import { ShareGoneError } from '@/lib/share/sources.ts';
import type { SharedSource } from '@/lib/share/view.ts';
import {
  openLocalTeamView,
  openTeamChannel,
  openTeamTaskStream,
  resolveLocalTeamViewUrl,
  TEAM_MACHINE_OFFLINE,
  TEAM_TASK_GONE,
  type TeamChannelEnd,
  type TeamChannelHandlers,
} from '@/lib/teams/channel.ts';
import { createSharedTask } from '../share/fixtures.ts';
import { createFakeTeamMachine, FakeTeamSocket, TEAM_TARGET } from './machine.ts';

function listen() {
  const messages: ShareMessage[] = [];
  const ends: TeamChannelEnd[] = [];
  const handlers: TeamChannelHandlers = {
    onMessage: (message) => messages.push(message),
    onEnd: (end) => ends.push(end),
  };
  return { messages, ends, handlers };
}

const TARGET = { teamId: 'team1', instanceId: 'p7m2', taskId: 'kai-task' };

describe('a team channel from this browser', () => {
  it('asks app.shinsa.dev for the machine, proves the team key and reads what the machine streams', async () => {
    const machine = createFakeTeamMachine();
    const { messages, ends, handlers } = listen();
    const stop = openTeamChannel(TEAM_TARGET, handlers, machine.options);
    await machine.ready;
    expect(machine.requests).toEqual([
      { url: '/__remote/teams/team1/connect', body: { instanceId: 'p7m2' } },
    ]);
    expect(machine.latest().url).toBe('wss://t-p7m2.shinsa.dev/team?token=t');
    expect(machine.hellos[0]?.view).toEqual({ kind: 'list' });
    await machine.send({ t: 'view', data: '{"tasks":[]}' });
    await waitFor(() => expect(messages).toEqual([{ t: 'view', data: '{"tasks":[]}' }]));
    stop();
    expect(machine.latest().closed).toBe(true);
    expect(ends).toEqual([]);
  });

  it('ends for good when the machine refuses, the team is gone or the task stops being shown', async () => {
    const wrong = createFakeTeamMachine();
    wrong.key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const refused = listen();
    openTeamChannel(TEAM_TARGET, refused.handlers, wrong.options);
    await waitFor(() => expect(refused.ends).toEqual([{ reason: 'You are not in this team.', gone: true }]));

    const removed = createFakeTeamMachine();
    removed.status = 403;
    const left = listen();
    openTeamChannel(TEAM_TARGET, left.handlers, removed.options);
    await waitFor(() => expect(left.ends).toEqual([{ reason: TEAM_TASK_GONE, gone: true }]));

    const machine = createFakeTeamMachine();
    const closed = listen();
    openTeamChannel(TEAM_TARGET, closed.handlers, machine.options);
    await machine.ready;
    await machine.send({ t: 'closed', reason: 'Not shown any more.' });
    await waitFor(() => expect(closed.ends).toEqual([{ reason: 'Not shown any more.', gone: true }]));
  });

  it('says the machine is offline when app.shinsa.dev fails, the socket drops or a frame is unreadable', async () => {
    const away = createFakeTeamMachine();
    away.status = 503;
    const unreachable = listen();
    openTeamChannel(TEAM_TARGET, unreachable.handlers, away.options);
    await waitFor(() => expect(unreachable.ends).toEqual([{ reason: TEAM_MACHINE_OFFLINE, gone: false }]));

    const machine = createFakeTeamMachine();
    const dropped = listen();
    openTeamChannel(TEAM_TARGET, dropped.handlers, machine.options);
    await machine.ready;
    machine.latest().emit('message', { data: new Uint8Array([1, 2, 3]).buffer });
    await waitFor(() => expect(dropped.ends).toEqual([{ reason: TEAM_MACHINE_OFFLINE, gone: false }]));

    const early = createFakeTeamMachine();
    early.answer = () => Promise.resolve();
    const unsealed = listen();
    openTeamChannel(TEAM_TARGET, unsealed.handlers, early.options);
    await waitFor(() => expect(early.sockets).toHaveLength(1));
    early.latest().emit('message', { data: new Uint8Array([1]).buffer });
    await waitFor(() => expect(unsealed.ends).toEqual([{ reason: TEAM_MACHINE_OFFLINE, gone: false }]));

    const closing = createFakeTeamMachine();
    const closed = listen();
    openTeamChannel(TEAM_TARGET, closed.handlers, closing.options);
    await closing.ready;
    closing.latest().emit('close', {});
    await waitFor(() => expect(closed.ends).toEqual([{ reason: TEAM_MACHINE_OFFLINE, gone: false }]));
  });

  it('refuses a welcome not signed with the team key, and a second welcome', async () => {
    const forged = createFakeTeamMachine();
    forged.answer = () => Promise.resolve();
    const stand = listen();
    openTeamChannel(TEAM_TARGET, stand.handlers, forged.options);
    await waitFor(() => expect(forged.sockets[0]?.sent).toHaveLength(1));
    forged
      .latest()
      .emit('message', { data: JSON.stringify({ type: 'welcome', ephemeral: 'x', proof: 'AAAA' }) });
    await waitFor(() => expect(stand.ends).toEqual([{ reason: TEAM_TASK_GONE, gone: true }]));

    const machine = createFakeTeamMachine();
    const twice = listen();
    openTeamChannel(TEAM_TARGET, twice.handlers, machine.options);
    await machine.ready;
    machine
      .latest()
      .emit('message', { data: JSON.stringify({ type: 'welcome', ephemeral: 'x', proof: 'AAAA' }) });
    await waitFor(() => expect(twice.ends).toEqual([{ reason: TEAM_MACHINE_OFFLINE, gone: false }]));
  });

  it('stops quietly when it is closed before app.shinsa.dev answers', async () => {
    const machine = createFakeTeamMachine();
    const { ends, handlers } = listen();
    const stop = openTeamChannel(TEAM_TARGET, handlers, machine.options);
    stop();
    await Promise.resolve();
    expect(machine.sockets).toEqual([]);
    expect(ends).toEqual([]);
  });
});

describe('a team task through this machine’s engine', () => {
  it('opens the engine’s relay on this machine and reads its plain messages', () => {
    expect(resolveLocalTeamViewUrl(TARGET, { protocol: 'https:', host: 'mac.local' })).toBe(
      'wss://mac.local/api/teams/view?team=team1&machine=p7m2&task=kai-task'
    );
    const sockets: FakeTeamSocket[] = [];
    const { messages, ends, handlers } = listen();
    const stop = openLocalTeamView(TARGET, handlers, {
      origin: { protocol: 'http:', host: 'localhost:5180' },
      createSocket: (url) => {
        const socket = new FakeTeamSocket(url, () => Promise.resolve(), false);
        sockets.push(socket);
        return socket;
      },
    });
    const socket = sockets[0] as FakeTeamSocket;
    expect(socket.url).toBe('ws://localhost:5180/api/teams/view?team=team1&machine=p7m2&task=kai-task');
    socket.emit('message', { data: serializeShareMessage({ t: 'view', data: '{}' }) });
    expect(messages).toEqual([{ t: 'view', data: '{}' }]);
    socket.emit('message', { data: serializeShareMessage({ t: 'closed', reason: 'Gone.' }) });
    socket.emit('message', { data: serializeShareMessage({ t: 'view', data: '{}' }) });
    expect(ends).toEqual([{ reason: 'Gone.', gone: true }]);
    expect(messages).toHaveLength(1);
    stop();
    expect(socket.closed).toBe(true);
  });

  it('uses the browser’s socket on this page’s own address by default', () => {
    const original = globalThis.WebSocket;
    const urls: string[] = [];
    globalThis.WebSocket = function createFakeSocket(url: string) {
      urls.push(url);
      return new FakeTeamSocket(url, () => Promise.resolve(), false);
    } as unknown as typeof WebSocket;
    const stop = openLocalTeamView(TARGET, listen().handlers);
    globalThis.WebSocket = original;
    stop();
    expect(urls).toEqual([resolveLocalTeamViewUrl(TARGET, location)]);
  });

  it('ends as offline when the relay closes or sends something unreadable', () => {
    const sockets: FakeTeamSocket[] = [];
    const createSocket = (url: string) => {
      const socket = new FakeTeamSocket(url, () => Promise.resolve(), false);
      sockets.push(socket);
      return socket;
    };
    const unreadable = listen();
    openLocalTeamView(TARGET, unreadable.handlers, { createSocket });
    sockets[0]?.emit('message', { data: new ArrayBuffer(2) });
    expect(unreadable.ends).toEqual([{ reason: UNREADABLE_MESSAGE, gone: false }]);
    const dropped = listen();
    openLocalTeamView(TARGET, dropped.handlers, { createSocket });
    sockets[1]?.emit('close', {});
    expect(dropped.ends).toEqual([{ reason: TEAM_MACHINE_OFFLINE, gone: false }]);
  });
});

describe('a teammate’s task page stream', () => {
  function createTransport() {
    const opened: TeamChannelHandlers[] = [];
    const stopped: number[] = [];
    return {
      opened,
      stopped,
      transport: (handlers: TeamChannelHandlers) => {
        opened.push(handlers);
        const index = opened.length;
        return () => stopped.push(index);
      },
    };
  }

  it('shows each view, opens again after a drop and stops for good once the task is gone', () => {
    const { opened, stopped, transport } = createTransport();
    const sources: SharedSource[] = [];
    const errors: Error[] = [];
    const waits: (() => void)[] = [];
    const stop = openTeamTaskStream(
      transport,
      { onSource: (source) => sources.push(source), onError: (error) => errors.push(error) },
      {
        wait: (_ms, run) => {
          waits.push(run);
          return () => undefined;
        },
        createUrl: () => 'blob:1',
        revokeUrl: () => undefined,
      }
    );
    const view = { shared: createSharedTask(), files: {}, updatedAt: 3 };
    opened[0]?.onMessage({ t: 'view', data: JSON.stringify(view) });
    expect(sources.map((source) => source.updatedAt)).toEqual([3]);
    opened[0]?.onEnd({ reason: TEAM_MACHINE_OFFLINE, gone: false });
    expect(errors.map((error) => error.message)).toEqual([TEAM_MACHINE_OFFLINE]);
    waits.shift()?.();
    expect(opened).toHaveLength(2);
    opened[1]?.onEnd({ reason: 'Gone.', gone: true });
    expect(errors.at(-1)).toBeInstanceOf(ShareGoneError);
    expect(errors.at(-1)?.message).toBe('Gone.');
    expect(waits).toEqual([]);
    stop();
    expect(stopped).toEqual([]);
  });

  it('closes its transport and any wait when the page closes', () => {
    const { opened, stopped, transport } = createTransport();
    let cancelled = false;
    const waits: (() => void)[] = [];
    const stop = openTeamTaskStream(
      transport,
      { onSource: () => undefined, onError: () => undefined },
      {
        wait: (_ms, run) => {
          waits.push(run);
          return () => {
            cancelled = true;
          };
        },
      }
    );
    stop();
    expect(stopped).toEqual([1]);
    opened[0]?.onMessage({ t: 'view', data: '{}' });
    opened[0]?.onEnd({ reason: TEAM_MACHINE_OFFLINE, gone: false });
    expect(waits).toEqual([]);
    const second = createTransport();
    const stopSecond = openTeamTaskStream(
      second.transport,
      { onSource: () => undefined, onError: () => undefined },
      {
        wait: (_ms, run) => {
          waits.push(run);
          return () => {
            cancelled = true;
          };
        },
      }
    );
    second.opened[0]?.onEnd({ reason: TEAM_MACHINE_OFFLINE, gone: false });
    stopSecond();
    expect(cancelled).toBe(true);
    waits.shift()?.();
    expect(second.opened).toHaveLength(1);
  });
});
