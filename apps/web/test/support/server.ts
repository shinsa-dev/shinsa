import {
  type AccountsSnapshot,
  CHAT_PROTOCOL_VERSION,
  type ChatEntry,
  type ChatEvent,
  type ClientMessage,
  type ServerMessage,
  type ShinsaState,
  serializeState,
  type UserCommand,
} from '@shinsa/core';
import { act } from '@testing-library/react';
import { connection } from '@/lib/connection/socket.ts';

type Listener = (event: { data?: string }) => void;

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = FakeSocket.CONNECTING;
  readonly #listeners = new Map<string, Listener[]>();

  constructor() {
    server.socket = this;
  }

  addEventListener(type: string, listener: Listener) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  removeEventListener() {}

  send(data: string) {
    server.receive(JSON.parse(data) as ClientMessage);
  }

  close() {}

  emit(type: string, event: { data?: string } = {}) {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

interface FakeServer {
  socket: FakeSocket | null;
  commands: UserCommand[];
  held: boolean;
  pending: string[];
  receive: (message: ClientMessage) => void;
}

const server: FakeServer = {
  socket: null,
  commands: [],
  held: false,
  pending: [],
  receive(message) {
    if (message.type !== 'command') return;
    server.commands.push(message.command);
    if (server.held) server.pending.push(message.id);
    else queueMicrotask(() => push({ type: 'ack', id: message.id, error: null }));
  },
};

function push(message: ServerMessage) {
  server.socket?.emit('message', { data: JSON.stringify(message) });
  connection.flush();
}

const globals = globalThis as { WebSocket: unknown };

const realWebSocket = globals.WebSocket;

export function startFakeServer() {
  globals.WebSocket = FakeSocket;
  if (server.socket) {
    server.socket.readyState = FakeSocket.OPEN;
  } else {
    connection.start();
    const socket = server.socket as FakeSocket | null;
    if (socket) {
      socket.readyState = FakeSocket.OPEN;
      socket.emit('open');
    }
  }
  server.commands = [];
  server.held = false;
  server.pending = [];
  return server;
}

export function stopFakeServer() {
  if (server.socket) server.socket.readyState = FakeSocket.CLOSED;
  globals.WebSocket = realWebSocket;
}

export function holdAcks() {
  server.held = true;
}

export function releaseAcks(error: { code: string; message: string } | null = null) {
  const ids = server.pending;
  server.pending = [];
  server.held = false;
  act(() => {
    for (const id of ids) push({ type: 'ack', id, error });
  });
}

export function pushState(state: ShinsaState) {
  act(() => {
    push({ type: 'state', state: state && serializeState(state) });
  });
}

export function clearAccounts() {
  act(() => connection.replaceAccounts(null));
}

export function pushAccounts(accounts: AccountsSnapshot) {
  act(() => {
    push({ type: 'accounts', accounts });
  });
}

export function pushTranscript(runId: string, entries: ChatEntry[], reset = true) {
  act(() => {
    push({
      type: 'transcript',
      runId,
      entries,
      start: reset ? 0 : connection.selectTranscript(runId).length,
    });
  });
}

export function pushSurfaces(desktop: boolean) {
  act(() => {
    push({ type: 'surfaces', desktop });
  });
}

export function listSentCommands() {
  return server.commands;
}

export function createEntry(event: ChatEvent, id: string, at: number): ChatEntry {
  return { ...event, v: CHAT_PROTOCOL_VERSION, id, at } as ChatEntry;
}
