import {
  type AccountsSnapshot,
  applyStatePatch,
  applyTaskDetail,
  type ChatEntry,
  type ClientMessage,
  type EngineCommand,
  type EngineFeature,
  type EngineInfo,
  hasEngineFeature,
  type MachineResources,
  NO_TEAM_FEED,
  type PlacementMachine,
  type RemoteSnapshot,
  type RemoteUser,
  resolveEngineCommands,
  type ServerMessage,
  type StatePatch,
  type Surface,
  type TaskDetail,
  type TeamFeedSnapshot,
  type TerminalsSnapshot,
  type UserCommand,
  type WireState,
} from '@shinsa/core';
import { Deferred, Effect, Exit, type Fiber, Layer } from 'effect';
import { Socket } from 'effect/socket';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { applyOptimistic, isOptimistic } from '@/lib/connection/optimistic.ts';
import { resolveSurface } from '@/lib/desktop.ts';
import { useSharedTranscript } from '@/lib/share/transcripts.ts';
import { forkApp, runApp } from '@/lib/runtime/app.ts';
import { createSignal } from '@/lib/signal.ts';
import {
  CONNECTION_LOST_MESSAGE,
  CommandRefused,
  type EngineLink,
  NOT_CONNECTED_MESSAGE,
  type SocketTransport,
  UPDATE_ENGINE_MESSAGE,
} from './engine-socket/schema.ts';
import { EngineSocket } from './engine-socket/service.ts';
import { selectReadOnlyRefusal } from './read-only.ts';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface Snapshot {
  state: WireState | null;
  status: ConnectionStatus;
}

interface Pending {
  message: ClientMessage;
  answer: Deferred.Deferred<void, CommandRefused>;
  drops: number;
}

interface TranscriptChunk {
  start: number;
  entries: ChatEntry[];
}

type Scheduler = (flush: () => void) => void;

type Incoming = { patch: StatePatch } | { detail: TaskDetail };

export interface MachineView {
  id: string;
  name: string;
  current: boolean;
  guest?: true;
  handedBy?: RemoteUser;
}

export interface MachineChoice extends PlacementMachine {
  current: boolean;
  guest?: true;
  resources?: MachineResources | null;
}

export interface UnreachableMachine {
  id: string;
  name: string;
  outdated?: boolean;
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
  requestTaskDetail: (taskId: string) => void;
  watchTaskDetail: (taskId: string) => () => void;
  subscribeAccounts: (listener: () => void) => () => void;
  selectAccounts: () => AccountsSnapshot | null;
  replaceAccounts: (accounts: AccountsSnapshot | null) => void;
  subscribeSurfaces: (listener: () => void) => () => void;
  isDesktopConnected: () => boolean;
  subscribeTerminals: (listener: () => void) => () => void;
  selectTerminals: () => TerminalsSnapshot | null;
  replaceTerminals: (terminals: TerminalsSnapshot) => void;
  subscribeResources: (listener: () => void) => () => void;
  selectResources: () => MachineResources | null;
  subscribeRemote: (listener: () => void) => () => void;
  selectRemote: () => RemoteSnapshot | null;
  replaceRemote: (remote: RemoteSnapshot) => void;
  subscribeTeams: (listener: () => void) => () => void;
  selectTeams: () => TeamFeedSnapshot;
  selectMachine: (id: string) => MachineView | null;
  listMachines: () => MachineChoice[];
  listUnreachableMachines: () => UnreachableMachine[];
  listMachineAccess: () => MachineAccess[];
  removeMachine: (id: string) => void;
  selectEngine: (id?: string | null) => EngineInfo | null;
  command: (command: UserCommand, machineId?: string | null) => Promise<void>;
  reset: () => void;
  flush: () => void;
}

export interface ConnectionOptions {
  transport?: SocketTransport;
  surface?: () => Surface;
  schedule?: Scheduler;
}

const MAX_RESENDS = 2;

const HIDDEN_FRAME_MS = 32;

export const NO_ENTRIES: ChatEntry[] = [];

export const NO_MACHINES: MachineChoice[] = [];

export const NO_UNREACHABLE_MACHINES: UnreachableMachine[] = [];

export const NO_MACHINE_ACCESS: MachineAccess[] = [];

const BASELINE_COMMANDS = resolveEngineCommands(null);

const engineCommands = new WeakMap<EngineInfo, ReadonlySet<string>>();

export function selectEngineCommands(engine: EngineInfo | null) {
  if (!engine) return BASELINE_COMMANDS;
  const known = engineCommands.get(engine);
  if (known) return known;
  const commands = resolveEngineCommands(engine);
  engineCommands.set(engine, commands);
  return commands;
}

export function resolveUpdateMessage(machineName: string) {
  return `Update Shinsa on ${machineName} to use this.`;
}

export const TRANSCRIPT_CACHE_LIMIT = 24;

export const TRANSCRIPT_ENTRY_LIMIT = 10_000;

function scheduleFrame(flush: () => void) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => flush());
  setTimeout(flush, HIDDEN_FRAME_MS);
}

function mergeTranscript(entries: ChatEntry[], chunk: TranscriptChunk): ChatEntry[] | null {
  if (chunk.start === 0) return chunk.entries;
  if (chunk.start > entries.length) return null;
  const fresh = chunk.entries.slice(entries.length - chunk.start);
  return fresh.length === 0 ? entries : [...entries, ...fresh];
}

export class Connection implements ShinsaConnection {
  #fiber: Fiber.Fiber<never> | null = null;
  #link: EngineLink | null = null;
  #snapshot: Snapshot = { state: null, status: 'connecting' };
  #confirmed: WireState | null = null;
  #incomingState: WireState | null | undefined = undefined;
  #incoming: Incoming[] = [];
  readonly #incomingTranscripts = new Map<string, TranscriptChunk[]>();
  #flushing = false;
  #syncing = false;
  #stopped = false;
  #accounts: AccountsSnapshot | null = null;
  #terminals: TerminalsSnapshot | null = null;
  #resources: MachineResources | null = null;
  #remote: RemoteSnapshot | null = null;
  #teams: TeamFeedSnapshot = NO_TEAM_FEED;
  #engine: EngineInfo | null = null;
  #desktopConnected = false;
  readonly #options: ConnectionOptions;
  readonly #state = createSignal();
  readonly #transcriptSignal = createSignal();
  readonly #accountsSignal = createSignal();
  readonly #surfacesSignal = createSignal();
  readonly #terminalsSignal = createSignal();
  readonly #resourcesSignal = createSignal();
  readonly #remoteSignal = createSignal();
  readonly #teamsSignal = createSignal();
  readonly #pending = new Map<string, Pending>();
  readonly #optimistic = new Map<string, UserCommand>();
  readonly #transcripts = new Map<string, ChatEntry[]>();
  readonly #transcriptRefs = new Map<string, number>();
  readonly #detailRefs = new Map<string, number>();
  readonly #detailsAsked = new Set<string>();

  constructor(options: ConnectionOptions = {}) {
    this.#options = options;
  }

  start() {
    if (this.#fiber !== null || this.#stopped) return;
    const transport = this.#options.transport ?? Socket.layerWebSocketConstructorGlobal;
    const session = {
      opened: (link: EngineLink) => this.#open(link),
      received: (message: ServerMessage) => this.#receive(message),
      closed: () => this.#close(),
    };
    const connect = Effect.gen(function* () {
      const socket = yield* EngineSocket;
      return yield* socket.connect(session);
    });
    this.#fiber = forkApp(
      connect.pipe(Effect.provide(EngineSocket.layer.pipe(Layer.provideMerge(transport))))
    );
  }

  stop() {
    this.#stopped = true;
    this.#link = null;
    this.#fiber?.interruptUnsafe();
    if (this.#snapshot.status !== 'closed') this.#update({ status: 'closed' });
  }

  #open(link: EngineLink) {
    this.#link = link;
    this.#syncing = true;
    this.#detailsAsked.clear();
    this.#update({ status: 'open' });
    this.#send({ type: 'hello', surface: (this.#options.surface ?? resolveSurface)() });
    for (const runId of this.#transcriptRefs.keys()) this.#subscribeTranscript(runId);
    for (const pending of this.#pending.values()) this.#send(pending.message);
  }

  #isOpen() {
    return this.#link?.isOpen() ?? false;
  }

  #close() {
    this.#link = null;
    this.#update({ status: 'closed' });
    this.#dropPending();
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

  subscribeResources = (listener: () => void) => this.#resourcesSignal.subscribe(listener);

  selectResources = () => this.#resources;

  subscribeRemote = (listener: () => void) => this.#remoteSignal.subscribe(listener);

  selectRemote = () => this.#remote;

  replaceRemote(remote: RemoteSnapshot) {
    this.#remote = remote;
    this.#remoteSignal.publish();
  }

  subscribeTeams = (listener: () => void) => this.#teamsSignal.subscribe(listener);

  selectTeams = () => this.#teams;

  isDesktopConnected = () => this.#desktopConnected;

  selectMachine = (_id: string): MachineView | null => null;

  listMachines = (): MachineChoice[] => NO_MACHINES;

  listUnreachableMachines = (): UnreachableMachine[] => NO_UNREACHABLE_MACHINES;

  listMachineAccess = (): MachineAccess[] => NO_MACHINE_ACCESS;

  removeMachine = (_id: string) => undefined;

  selectEngine = (_id?: string | null) => this.#engine;

  replaceAccounts(accounts: AccountsSnapshot | null) {
    this.#accounts = accounts;
    this.#accountsSignal.publish();
  }

  selectTranscript(runId: string) {
    return this.#transcripts.get(runId) ?? NO_ENTRIES;
  }

  command(command: UserCommand) {
    return runApp(
      Effect.suspend(() => {
        if (!this.#isOpen())
          return Effect.fail(new CommandRefused({ code: 'not_connected', message: NOT_CONNECTED_MESSAGE }));
        if (!selectEngineCommands(this.#engine).has(command.type))
          return Effect.fail(new CommandRefused({ code: 'engine_outdated', message: UPDATE_ENGINE_MESSAGE }));
        const message: ClientMessage = { type: 'command', id: crypto.randomUUID(), command };
        const answer = Deferred.makeUnsafe<void, CommandRefused>();
        this.#pending.set(message.id, { message, answer, drops: 0 });
        if (isOptimistic(command) && this.#confirmed) {
          this.#optimistic.set(message.id, command);
          this.#publishState();
        }
        this.#send(message);
        return Deferred.await(answer);
      })
    );
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

  requestTaskDetail(taskId: string) {
    const task = this.#confirmed?.tasks[taskId];
    if (!task?.summarized || this.#detailsAsked.has(taskId)) return;
    if (!this.#isOpen()) return;
    this.#detailsAsked.add(taskId);
    this.#send({ type: 'task.detail', taskId });
  }

  watchTaskDetail(taskId: string) {
    this.#detailRefs.set(taskId, (this.#detailRefs.get(taskId) ?? 0) + 1);
    this.requestTaskDetail(taskId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.#detailRefs.get(taskId) ?? 1) - 1;
      if (remaining > 0) this.#detailRefs.set(taskId, remaining);
      else this.#detailRefs.delete(taskId);
    };
  }

  reset() {
    this.#confirmed = null;
    this.#incomingState = undefined;
    this.#incoming = [];
    this.#incomingTranscripts.clear();
    this.#syncing = false;
    this.#accounts = null;
    this.#terminals = null;
    this.#resources = null;
    this.#remote = null;
    this.#teams = NO_TEAM_FEED;
    this.#engine = null;
    this.#desktopConnected = false;
    this.#pending.clear();
    this.#optimistic.clear();
    this.#transcripts.clear();
    this.#transcriptRefs.clear();
    this.#detailRefs.clear();
    this.#detailsAsked.clear();
    this.#update({ state: null });
    this.#transcriptSignal.publish();
    this.#accountsSignal.publish();
    this.#surfacesSignal.publish();
    this.#terminalsSignal.publish();
    this.#resourcesSignal.publish();
    this.#remoteSignal.publish();
    this.#teamsSignal.publish();
  }

  flush() {
    this.#flushing = false;
    if (this.#flushState()) {
      this.#publishState();
      this.#requestWatchedDetails();
    }
    if (this.#flushTranscripts()) this.#transcriptSignal.publish();
  }

  #scheduleFlush() {
    if (this.#flushing) return;
    this.#flushing = true;
    (this.#options.schedule ?? scheduleFrame)(() => {
      if (this.#flushing) this.flush();
    });
  }

  #requestWatchedDetails() {
    for (const taskId of this.#detailRefs.keys()) this.requestTaskDetail(taskId);
  }

  #flushState() {
    const incoming = this.#incoming;
    const full = this.#incomingState !== undefined;
    let base = full ? (this.#incomingState ?? null) : this.#confirmed;
    if (full) {
      this.#syncing = false;
      this.#detailsAsked.clear();
    }
    this.#incomingState = undefined;
    this.#incoming = [];
    for (const entry of incoming) {
      if (!base || this.#syncing) break;
      const next = this.#applyIncoming(base, entry);
      if (!next) {
        this.#syncing = true;
        this.#detailsAsked.clear();
        this.#send({ type: 'state.sync' });
        break;
      }
      base = next;
    }
    if (base === this.#confirmed) return false;
    this.#confirmed = base;
    return true;
  }

  #applyIncoming(base: WireState, entry: Incoming) {
    if ('detail' in entry) return applyTaskDetail(base, entry.detail);
    const { patch } = entry;
    if (patch.to < base.seq || (patch.to === base.seq && patch.from < patch.to)) return base;
    return applyStatePatch(base, patch);
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
      Deferred.doneUnsafe(
        pending.answer,
        Exit.fail(new CommandRefused({ code: 'connection_lost', message: CONNECTION_LOST_MESSAGE }))
      );
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
    const link = this.#link;
    if (link?.isOpen()) forkApp(link.send(message));
  }

  #receive(message: ServerMessage) {
    switch (message.type) {
      case 'state':
        this.#incomingState = message.state;
        this.#incoming = [];
        this.#scheduleFlush();
        return;
      case 'state.patch':
        this.#incoming.push({ patch: message.patch });
        this.#scheduleFlush();
        return;
      case 'ack': {
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (!pending) return;
        this.flush();
        this.#settleOptimistic(message.id);
        Deferred.doneUnsafe(
          pending.answer,
          message.error ? Exit.fail(new CommandRefused(message.error)) : Exit.void
        );
        return;
      }
      case 'transcript': {
        const chunks = this.#incomingTranscripts.get(message.runId) ?? [];
        chunks.push({ start: message.start, entries: [...message.entries] });
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
      case 'resources':
        this.#resources = message.resources;
        this.#resourcesSignal.publish();
        return;
      case 'teams':
        this.#teams = message.teams;
        this.#teamsSignal.publish();
        return;
      case 'engine':
        this.#engine = message.engine;
        this.#state.publish();
        return;
      case 'task.detail':
        this.#incoming.push({ detail: message.detail });
        this.#scheduleFlush();
        return;
    }
  }
}

export function resolveSocketTransport(open: () => WebSocket): SocketTransport {
  return Layer.succeed(Socket.WebSocketConstructor, () => open());
}

const localConnection = new Connection();

export let connection: ShinsaConnection = localConnection;

export function replaceConnection(next: ShinsaConnection | null) {
  connection = next ?? localConnection;
}

function useListedMachines() {
  return useSyncExternalStore(connection.subscribe, connection.listMachines);
}

export function useMachines() {
  const listed = useListedMachines();
  return useMemo(() => listed.filter((machine) => !machine.guest), [listed]);
}

export function useGuestMachines() {
  const listed = useListedMachines();
  return useMemo(() => listed.filter((machine) => machine.guest), [listed]);
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
  const shared = useSharedTranscript(runId);
  const watched = shared === null;
  useEffect(() => {
    if (!(runId && watched)) return;
    return connection.watchTranscript(runId);
  }, [runId, watched]);
  const live = useSyncExternalStore(connection.subscribeTranscripts, () =>
    runId ? connection.selectTranscript(runId) : NO_ENTRIES
  );
  return shared ?? live;
}

export function useTaskDetail(taskId: string | null) {
  useEffect(() => {
    if (!taskId) return;
    return connection.watchTaskDetail(taskId);
  }, [taskId]);
}

export function sendCommand(command: UserCommand, machineId?: string | null) {
  const refusal = selectReadOnlyRefusal();
  if (refusal) return Promise.reject(refusal);
  return connection.command(command, machineId);
}

export function useRemoteSnapshot() {
  return useSyncExternalStore(connection.subscribeRemote, connection.selectRemote);
}

export function useTeamFeed() {
  return useSyncExternalStore(connection.subscribeTeams, connection.selectTeams);
}

export function useEngineCommands(id?: string | null) {
  return useSyncExternalStore(connection.subscribe, () => selectEngineCommands(connection.selectEngine(id)));
}

export function hasEngineCommand(type: EngineCommand, id?: string | null) {
  return selectEngineCommands(connection.selectEngine(id)).has(type);
}

export function useEngineCommand(type: EngineCommand, id?: string | null) {
  return useEngineCommands(id).has(type);
}

export function useEngineFeature(feature: EngineFeature, id?: string | null) {
  return useSyncExternalStore(connection.subscribe, () =>
    hasEngineFeature(connection.selectEngine(id), feature)
  );
}

export function useMachineAccess() {
  return useSyncExternalStore(connection.subscribeRemote, connection.listMachineAccess);
}
