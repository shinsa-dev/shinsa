import type { ChatEntry, ClientMessage, ServerMessage, ShinsaState, UserCommand } from '@shinsa/core';
import { useEffect, useSyncExternalStore } from 'react';
import { createSignal } from './signal.ts';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

interface Snapshot {
  state: ShinsaState | null;
  status: ConnectionStatus;
}

interface Pending {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface ConnectionOptions {
  openSocket: () => WebSocket;
  retry: (reconnect: () => void, delayMs: number) => void;
}

export const RETRY_STEPS_MS = [250, 1000, 2000, 5000];

const NO_ENTRIES: ChatEntry[] = [];

function openShinsaSocket() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return new WebSocket(`${protocol}://${location.host}/ws`);
}

export class Connection {
  #socket: WebSocket | null = null;
  #snapshot: Snapshot = { state: null, status: 'connecting' };
  #attempt = 0;
  readonly #options: ConnectionOptions;
  readonly #state = createSignal();
  readonly #transcriptSignal = createSignal();
  readonly #pending = new Map<string, Pending>();
  readonly #transcripts = new Map<string, ChatEntry[]>();
  readonly #transcriptRefs = new Map<string, number>();

  constructor(options: ConnectionOptions) {
    this.#options = options;
  }

  start() {
    const socket = this.#options.openSocket();
    this.#socket = socket;
    socket.addEventListener('open', () => {
      this.#attempt = 0;
      this.#update({ status: 'open' });
      for (const runId of this.#transcriptRefs.keys()) this.#send({ type: 'transcript.subscribe', runId });
    });
    socket.addEventListener('message', (event) => {
      this.#receive(JSON.parse(String(event.data)) as ServerMessage);
    });
    socket.addEventListener('close', () => {
      this.#update({ status: 'closed' });
      for (const pending of this.#pending.values())
        pending.reject(new Error('Lost the connection to Shinsa.'));
      this.#pending.clear();
      const delay = RETRY_STEPS_MS[Math.min(this.#attempt, RETRY_STEPS_MS.length - 1)] ?? 5000;
      this.#attempt += 1;
      this.#options.retry(() => this.start(), delay);
    });
  }

  subscribe = (listener: () => void) => this.#state.subscribe(listener);

  snapshot = () => this.#snapshot;

  subscribeTranscripts = (listener: () => void) => this.#transcriptSignal.subscribe(listener);

  selectTranscript(runId: string) {
    return this.#transcripts.get(runId) ?? NO_ENTRIES;
  }

  command(command: UserCommand) {
    return new Promise<void>((resolve, reject) => {
      if (this.#socket?.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to Shinsa.'));
        return;
      }
      const id = crypto.randomUUID();
      this.#pending.set(id, { resolve, reject });
      this.#send({ type: 'command', id, command });
    });
  }

  watchTranscript(runId: string) {
    const count = this.#transcriptRefs.get(runId) ?? 0;
    this.#transcriptRefs.set(runId, count + 1);
    if (count === 0) this.#send({ type: 'transcript.subscribe', runId });
    return () => {
      const remaining = (this.#transcriptRefs.get(runId) ?? 1) - 1;
      if (remaining > 0) {
        this.#transcriptRefs.set(runId, remaining);
        return;
      }
      this.#transcriptRefs.delete(runId);
      this.#send({ type: 'transcript.unsubscribe', runId });
    };
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
    }
  }
}

export const connection = new Connection({
  openSocket: openShinsaSocket,
  retry: (reconnect, delayMs) => {
    setTimeout(reconnect, delayMs);
  },
});

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
