import {
  type AccountsSnapshot,
  applyStatePatch,
  type ChatEntry,
  type ClientMessage,
  type PlacementMachine,
  type RemoteSnapshot,
  type ServerMessage,
  type StatePatch,
  type Surface,
  type TerminalsSnapshot,
  type UserCommand,
  type WireState,
} from '@shinsa/core';
import { useEffect, useSyncExternalStore } from 'react';
import { applyOptimistic, isOptimistic } from '@/lib/connection/optimistic.ts';
import { resolveSurface } from '@/lib/desktop.ts';
import { createSignal } from '@/lib/signal.ts';
import { selectReadOnlyRefusal } from './read-only.ts';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface Snapshot {
  state: WireState | null;
  status: ConnectionStatus;
}

interface Pending {
  message: ClientMessage;
  resolve: () => void;
  reject: (error: Error) => void;
  drops: number;
}

interface TranscriptChunk {
  start: number;
  entries: ChatEntry[];
}

type Scheduler = (flush: () => void) => void;

export interface MachineView {
  id: string;
  name: string;
  current: boolean;
}

export interface MachineChoice extends PlacementMachine {
  current: boolean;
}

export interface UnreachableMachine {
  id: string;
  name: string;
}

export interface MachineAccess {
  id: string;
  name: string;
  remote: RemoteSnapshot | null;
}

export interface ShinsaConnection {
  start: () => void;
  subscribe: (listener: () => void) => () => void;
  snapshot: () => Snapshot;
  subscribeTranscripts: (listener: () => void) => () => void;
  selectTranscript: (runId: string) => ChatEntry[];
  watchTranscript: (runId: string) => () => void;
  subscribeAccounts: (listener: () => void) => () => void;
  selectAccounts: () => AccountsSnapshot | null;
  replaceAccounts: (accounts: AccountsSnapshot | null) => void;
  subscribeSurfaces: (listener: () => void) => () => void;
  isDesktopConnected: () => boolean;
  subscribeTerminals: (listener: () => void) => () => void;
  selectTerminals: () => TerminalsSnapshot | null;
  replaceTerminals: (terminals: TerminalsSnapshot) => void;
  subscribeRemote: (listener: () => void) => () => void;
  selectRemote: () => RemoteSnapshot | null;
  replaceRemote: (remote: RemoteSnapshot) => void;
  selectMachine: (id: string) => MachineView | null;
  listMachines: () => MachineChoice[];
  listUnreachableMachines: () => UnreachableMachine[];
  listMachineAccess: () => MachineAccess[];
  command: (command: UserCommand, machineId?: string | null) => Promise<void>;
  reset: () => void;
  flush: () => void;
}

export interface ConnectionOptions {
  openSocket: () => WebSocket;
  retry: (reconnect: () => void, delayMs: number) => void;
  surface?: () => Surface;
  schedule?: Scheduler;
}

const RETRY_STEPS_MS = [250, 1000, 2000, 5000];

const MAX_RESENDS = 2;

const HIDDEN_FRAME_MS = 32;

export const NO_ENTRIES: ChatEntry[] = [];

export const NO_MACHINES: MachineChoice[] = [];

export const NO_UNREACHABLE_MACHINES: UnreachableMachine[] = [];

export const NO_MACHINE_ACCESS: MachineAccess[] = [];

export const TRANSCRIPT_CACHE_LIMIT = 24;

export const TRANSCRIPT_ENTRY_LIMIT = 10_000;

function openShinsaSocket() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return new WebSocket(`${protocol}://${location.host}/ws`);
}

export function retryLater(reconnect: () => void, delayMs: number) {
  setTimeout(reconnect, delayMs);
}

function scheduleFrame(flush: () => void) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => flush());
  setTimeout(flush, HIDDEN_FRAME_MS);
}

function parseServerMessage(data: string) {
  try {
    return JSON.parse(data) as ServerMessage;
  } catch {
    return null;
  }
}

function mergeTranscript(entries: ChatEntry[], chunk: TranscriptChunk): ChatEntry[] | null {
  if (chunk.start === 0) return chunk.entries;
  if (chunk.start > entries.length) return null;
  const fresh = chunk.entries.slice(entries.length - chunk.start);
  return fresh.length === 0 ? entries : [...entries, ...fresh];
}

export class Connection implements ShinsaConnection {
  #socket: WebSocket | null = null;
  #snapshot: Snapshot = { state: null, status: 'connecting' };
  #confirmed: WireState | null = null;
  #incomingState: WireState | null | undefined = undefined;
  #incomingPatches: StatePatch[] = [];
  readonly #incomingTranscripts = new Map<string, TranscriptChunk[]>();
  #flushing = false;
  #syncing = false;
  #attempt = 0;
  #accounts: AccountsSnapshot | null = null;
  #terminals: TerminalsSnapshot | null = null;
  #remote: RemoteSnapshot | null = null;
  #desktopConnected = false;
  readonly #options: ConnectionOptions;
  readonly #state = createSignal();
  readonly #transcriptSignal = createSignal();
  readonly #accountsSignal = createSignal();
  readonly #surfacesSignal = createSignal();
  readonly #terminalsSignal = createSignal();
  readonly #remoteSignal = createSignal();
  readonly #pending = new Map<string, Pending>();
  readonly #optimistic = new Map<string, UserCommand>();
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
      this.#syncing = true;
      this.#update({ status: 'open' });
      this.#send({ type: 'hello', surface: (this.#options.surface ?? resolveSurface)() });
      for (const runId of this.#transcriptRefs.keys()) this.#subscribeTranscript(runId);
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

  subscribeSurfaces = (listener: () => void) => this.#surfacesSignal.subscribe(listener);

  subscribeTerminals = (listener: () => void) => this.#terminalsSignal.subscribe(listener);

  selectTerminals = () => this.#terminals;

  replaceTerminals(terminals: TerminalsSnapshot) {
    this.#terminals = terminals;
    this.#terminalsSignal.publish();
  }

  subscribeRemote = (listener: () => void) => this.#remoteSignal.subscribe(listener);

  selectRemote = () => this.#remote;

  replaceRemote(remote: RemoteSnapshot) {
    this.#remote = remote;
    this.#remoteSignal.publish();
  }

  isDesktopConnected = () => this.#desktopConnected;

  selectMachine = (_id: string): MachineView | null => null;

  listMachines = (): MachineChoice[] => NO_MACHINES;

  listUnreachableMachines = (): UnreachableMachine[] => NO_UNREACHABLE_MACHINES;

  listMachineAccess = (): MachineAccess[] => NO_MACHINE_ACCESS;

  replaceAccounts(accounts: AccountsSnapshot | null) {
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
      if (isOptimistic(command) && this.#confirmed) {
        this.#optimistic.set(message.id, command);
        this.#publishState();
      }
      this.#send(message);
    });
  }

  watchTranscript(runId: string) {
    const count = this.#transcriptRefs.get(runId) ?? 0;
    this.#transcriptRefs.set(runId, count + 1);
    this.#touchTranscript(runId);
    if (count === 0) this.#subscribeTranscript(runId);
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
      this.#touchTranscript(runId);
      this.#evictTranscripts();
    };
  }

  reset() {
    this.#confirmed = null;
    this.#incomingState = undefined;
    this.#incomingPatches = [];
    this.#incomingTranscripts.clear();
    this.#syncing = false;
    this.#accounts = null;
    this.#terminals = null;
    this.#remote = null;
    this.#desktopConnected = false;
    this.#pending.clear();
    this.#optimistic.clear();
    this.#transcripts.clear();
    this.#transcriptRefs.clear();
    this.#update({ state: null });
    this.#transcriptSignal.publish();
    this.#accountsSignal.publish();
    this.#surfacesSignal.publish();
    this.#terminalsSignal.publish();
    this.#remoteSignal.publish();
  }

  flush() {
    this.#flushing = false;
    if (this.#flushState()) this.#publishState();
    if (this.#flushTranscripts()) this.#transcriptSignal.publish();
  }

  #scheduleFlush() {
    if (this.#flushing) return;
    this.#flushing = true;
    (this.#options.schedule ?? scheduleFrame)(() => {
      if (this.#flushing) this.flush();
    });
  }

  #flushState() {
    const patches = this.#incomingPatches;
    const full = this.#incomingState !== undefined;
    let base = full ? (this.#incomingState ?? null) : this.#confirmed;
    if (full) this.#syncing = false;
    this.#incomingState = undefined;
    this.#incomingPatches = [];
    for (const patch of patches) {
      if (!base || this.#syncing) break;
      if (patch.to < base.seq || (patch.to === base.seq && patch.from < patch.to)) continue;
      const next = applyStatePatch(base, patch);
      if (!next) {
        this.#syncing = true;
        this.#send({ type: 'state.sync' });
        break;
      }
      base = next;
    }
    if (base === this.#confirmed) return false;
    this.#confirmed = base;
    return true;
  }

  #flushTranscripts() {
    if (this.#incomingTranscripts.size === 0) return false;
    for (const [runId, chunks] of this.#incomingTranscripts) {
      let entries = this.selectTranscript(runId);
      for (const chunk of chunks) {
        const merged = mergeTranscript(entries, chunk);
        if (!merged) {
          if (this.#transcriptRefs.has(runId)) this.#subscribeTranscript(runId, entries.length);
          break;
        }
        entries = merged;
      }
      if (entries !== NO_ENTRIES) this.#replaceTranscript(runId, entries);
    }
    this.#incomingTranscripts.clear();
    this.#evictTranscripts();
    return true;
  }

  #replaceTranscript(runId: string, entries: ChatEntry[]) {
    this.#transcripts.delete(runId);
    this.#transcripts.set(runId, entries);
  }

  #touchTranscript(runId: string) {
    const entries = this.#transcripts.get(runId);
    if (entries) this.#replaceTranscript(runId, entries);
  }

  #evictTranscripts() {
    let runs = this.#transcripts.size;
    let entries = 0;
    for (const kept of this.#transcripts.values()) entries += kept.length;
    for (const [runId, kept] of this.#transcripts) {
      if (runs <= TRANSCRIPT_CACHE_LIMIT && entries <= TRANSCRIPT_ENTRY_LIMIT) return;
      if (this.#transcriptRefs.has(runId)) continue;
      this.#transcripts.delete(runId);
      runs -= 1;
      entries -= kept.length;
    }
  }

  #publishState() {
    const confirmed = this.#confirmed;
    const state =
      confirmed && this.#optimistic.size > 0
        ? applyOptimistic(confirmed, this.#optimistic.values())
        : confirmed;
    this.#update({ state });
  }

  #subscribeTranscript(runId: string, from = this.selectTranscript(runId).length) {
    this.#send({ type: 'transcript.subscribe', runId, from });
  }

  #dropPending() {
    for (const [id, pending] of this.#pending) {
      pending.drops += 1;
      if (pending.drops <= MAX_RESENDS) continue;
      this.#pending.delete(id);
      this.#settleOptimistic(id);
      pending.reject(new Error('Lost the connection to Shinsa.'));
    }
  }

  #settleOptimistic(id: string) {
    if (this.#optimistic.delete(id)) this.#publishState();
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
        this.#incomingState = message.state;
        this.#incomingPatches = [];
        this.#scheduleFlush();
        return;
      case 'state.patch':
        this.#incomingPatches.push(message.patch);
        this.#scheduleFlush();
        return;
      case 'ack': {
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (!pending) return;
        this.flush();
        this.#settleOptimistic(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve();
        return;
      }
      case 'transcript': {
        const chunks = this.#incomingTranscripts.get(message.runId) ?? [];
        chunks.push({ start: message.start, entries: message.entries });
        this.#incomingTranscripts.set(message.runId, chunks);
        this.#scheduleFlush();
        return;
      }
      case 'accounts':
        this.replaceAccounts(message.accounts);
        return;
      case 'surfaces':
        this.#desktopConnected = message.desktop;
        this.#surfacesSignal.publish();
        return;
      case 'terminals':
        this.replaceTerminals(message.terminals);
        return;
      case 'remote':
        this.replaceRemote(message.remote);
        return;
      case 'engine':
        return;
    }
  }
}

const localConnection = new Connection();

export let connection: ShinsaConnection = localConnection;

export function replaceConnection(next: ShinsaConnection | null) {
  connection = next ?? localConnection;
}

export function useMachines() {
  return useSyncExternalStore(connection.subscribe, connection.listMachines);
}

export function useUnreachableMachines() {
  return useSyncExternalStore(connection.subscribe, connection.listUnreachableMachines);
}

export function useMachine(id: string | null) {
  return useSyncExternalStore(connection.subscribe, () => (id ? connection.selectMachine(id) : null));
}

export function useConnection() {
  return useSyncExternalStore(connection.subscribe, connection.snapshot);
}

export function useDesktopConnected() {
  return useSyncExternalStore(connection.subscribeSurfaces, connection.isDesktopConnected);
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

export function sendCommand(command: UserCommand, machineId?: string | null) {
  const refusal = selectReadOnlyRefusal();
  if (refusal) return Promise.reject(refusal);
  return connection.command(command, machineId);
}

export function useMachineAccess() {
  return useSyncExternalStore(connection.subscribeRemote, connection.listMachineAccess);
}
