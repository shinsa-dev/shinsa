import type {
  AccountsSnapshot,
  ChatEntry,
  ClientMessage,
  ServerMessage,
  ShinsaState,
  UserCommand,
} from '@shinsa/core';
import { useEffect, useSyncExternalStore } from 'react';
import { createSignal } from '@/lib/signal.ts';

type ConnectionStatus = 'connecting' | 'open' | 'closed';

interface Snapshot {
  state: ShinsaState | null;
  status: ConnectionStatus;
}

interface Pending {
  message: ClientMessage;
  resolve: () => void;
  reject: (error: Error) => void;
  drops: number;
}

interface ConnectionOptions {
  openSocket: () => WebSocket;
  retry: (reconnect: () => void, delayMs: number) => void;
}

const RETRY_STEPS_MS = [250, 1000, 2000, 5000];

const MAX_RESENDS = 2;

const NO_ENTRIES: ChatEntry[] = [];

function openShinsaSocket() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return new WebSocket(`${protocol}://${location.host}/ws`);
}

function retryLater(reconnect: () => void, delayMs: number) {
  setTimeout(reconnect, delayMs);
}

function parseServerMessage(data: string) {
  try {
    return JSON.parse(data) as ServerMessage;
  } catch {
    return null;
  }
}

export class Connection {
  #socket: WebSocket | null = null;
  #snapshot: Snapshot = { state: null, status: 'connecting' };
  #attempt = 0;
  #accounts: AccountsSnapshot | null = null;
  readonly #options: ConnectionOptions;
  readonly #state = createSignal();
  readonly #transcriptSignal = createSignal();
  readonly #accountsSignal = createSignal();
  readonly #pending = new Map<string, Pending>();
  readonly #transcripts = new Map<string, ChatEntry[]>();
  readonly #transcriptRefs = new Map<string, number>();

  constructor(options: ConnectionOptions = { openSocket: openShinsaSocket, retry: retryLater }) {
    this.#options = options;
  }

  start() {
    if (this.#socket === null) this.#connect();
  }

  #connect() {
    const socket = this.#options.openSocket();
    this.#socket = socket;
    socket.addEventListener('open', () => {
      this.#attempt = 0;
      this.#update({ status: 'open' });
      for (const runId of this.#transcriptRefs.keys()) this.#send({ type: 'transcript.subscribe', runId });
      for (const pending of this.#pending.values()) this.#send(pending.message);
    });
    socket.addEventListener('message', (event) => {
      const message = parseServerMessage(String(event.data));
      if (message) this.#receive(message);
    });
    socket.addEventListener('close', () => {
      this.#update({ status: 'closed' });
      this.#dropPending();
      const delay = RETRY_STEPS_MS[Math.min(this.#attempt, RETRY_STEPS_MS.length - 1)] ?? 5000;
      this.#attempt += 1;
      this.#options.retry(() => this.#connect(), delay);
    });
  }

  subscribe = (listener: () => void) => this.#state.subscribe(listener);

  snapshot = () => this.#snapshot;

  subscribeTranscripts = (listener: () => void) => this.#transcriptSignal.subscribe(listener);

  subscribeAccounts = (listener: () => void) => this.#accountsSignal.subscribe(listener);

  selectAccounts = () => this.#accounts;

  replaceAccounts(accounts: AccountsSnapshot) {
    this.#accounts = accounts;
    this.#accountsSignal.publish();
  }

  selectTranscript(runId: string) {
    return this.#transcripts.get(runId) ?? NO_ENTRIES;
  }

  command(command: UserCommand) {
    return new Promise<void>((resolve, reject) => {
      if (this.#socket?.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to Shinsa.'));
        return;
      }
      const message: ClientMessage = { type: 'command', id: crypto.randomUUID(), command };
      this.#pending.set(message.id, { message, resolve, reject, drops: 0 });
      this.#send(message);
    });
  }

  watchTranscript(runId: string) {
    const count = this.#transcriptRefs.get(runId) ?? 0;
    this.#transcriptRefs.set(runId, count + 1);
    if (count === 0) this.#send({ type: 'transcript.subscribe', runId });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.#transcriptRefs.get(runId) ?? 1) - 1;
      if (remaining > 0) {
        this.#transcriptRefs.set(runId, remaining);
        return;
      }
      this.#transcriptRefs.delete(runId);
      this.#send({ type: 'transcript.unsubscribe', runId });
    };
  }

  #dropPending() {
    for (const [id, pending] of this.#pending) {
      pending.drops += 1;
      if (pending.drops <= MAX_RESENDS) continue;
      this.#pending.delete(id);
      pending.reject(new Error('Lost the connection to Shinsa.'));
    }
  }

  #update(patch: Partial<Snapshot>) {
    this.#snapshot = { ...this.#snapshot, ...patch };
    this.#state.publish();
  }

  #send(message: ClientMessage) {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message));
  }

  #receive(message: ServerMessage) {
    switch (message.type) {
      case 'state':
        this.#update({ state: message.state });
        return;
      case 'ack': {
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (!pending) return;
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve();
        return;
      }
      case 'transcript': {
        const existing = message.reset ? [] : (this.#transcripts.get(message.runId) ?? []);
        this.#transcripts.set(message.runId, [...existing, ...message.entries]);
        this.#transcriptSignal.publish();
        return;
      }
      case 'accounts':
        this.replaceAccounts(message.accounts);
        return;
    }
  }
}

export const connection = new Connection();

export function useConnection() {
  return useSyncExternalStore(connection.subscribe, connection.snapshot);
}

export function useTranscript(runId: string | null) {
  useEffect(() => {
    if (!runId) return;
    return connection.watchTranscript(runId);
  }, [runId]);
  return useSyncExternalStore(connection.subscribeTranscripts, () =>
    runId ? connection.selectTranscript(runId) : NO_ENTRIES
  );
}

export function sendCommand(command: UserCommand) {
  return connection.command(command);
}
