import {
  type EngineInfo,
  hasEngineFeature,
  isEngineProtocolMatch,
  type MachineResources,
  NO_TEAM_FEED,
  type RemoteSnapshot,
  type RemoteUser,
  isHeldBy,
  SCOPE_MESSAGES,
  TEAM_RELAY_PATH,
  TEAM_SCOPE_MESSAGES,
  type TeamFeedSnapshot,
  type TerminalsSnapshot,
  type UserCommand,
  type WireState,
} from '@shinsa/core';
import { Effect, Option, Result, Schema } from 'effect';
import {
  type ConnectionStatus,
  type MachineAccess,
  type MachineChoice,
  type MachineView,
  NO_ENTRIES,
  NO_MACHINE_ACCESS,
  NO_MACHINES,
  NO_UNREACHABLE_MACHINES,
  resolveSocketTransport,
  resolveUpdateMessage,
  type ShinsaConnection,
  type Snapshot,
  selectEngineCommands,
  type TeammateMachine,
  type UnreachableMachine,
} from '@/lib/connection/socket.ts';
import { describeOutdatedMachine } from '@/lib/remote/mode.ts';
import { NO_MACHINE_CONNECTED, NoMachineConnected } from '@/lib/remote/schema.ts';
import { runApp } from '@/lib/runtime/app.ts';
import type { SocketTransport } from '@/lib/runtime/socket/schema.ts';
import { createSignal } from '@/lib/signal.ts';
import { mergeTeamFeeds, type TeamFeedSource } from '@/lib/teams/feeds.ts';
import { replaceSharedHandles } from '@/router.ts';

export interface FleetMember {
  id: string;
  name: string;
  current?: boolean;
  online?: boolean;
  guest?: true;
  handedBy?: RemoteUser;
  teammate?: TeammateMachine;
  connection: ShinsaConnection;
  fetch: (request: Request) => Promise<Response>;
  openTerminal?: (terminalId: string) => WebSocket;
  resolveUrl?: (path: string) => string;
  appOrigin?: string;
  close?: () => void;
}

const FLEET_RECORDS = [
  'repos',
  'projects',
  'tasks',
  'runs',
  'gates',
  'evidence',
  'briefings',
  'schedules',
  'memories',
  'sessionUsage',
] as const satisfies readonly (keyof WireState)[];

const SCAN_DEPTH = 4;

interface FleetPart {
  id: string;
  state: WireState;
  teammate?: Pick<TeammateMachine, 'viewerId'>;
}

export interface FleetState {
  state: WireState;
  owners: ReadonlyMap<string, string>;
  sharedHandles: ReadonlySet<string>;
}

function mergePresence(parts: FleetPart[]) {
  const presence: Record<string, number> = {};
  for (const part of parts)
    for (const [hour, count] of Object.entries(part.state.presence ?? {}))
      presence[hour] = (presence[hour] ?? 0) + count;
  return presence;
}

function mergeKeyed<K extends 'away' | 'focusHistory'>(parts: FleetPart[], key: K) {
  return Object.assign({}, ...parts.map((part) => part.state[key] ?? {})) as WireState[K];
}

export function listSharedHandles(parts: FleetPart[]) {
  const seen = new Map<string, string>();
  const shared = new Set<string>();
  for (const part of parts)
    for (const task of Object.values(part.state.tasks)) {
      if (!task.handle) continue;
      const first = seen.get(task.handle);
      if (first === undefined) seen.set(task.handle, part.id);
      else if (first !== part.id) shared.add(task.handle);
    }
  return shared;
}

const TEAMMATE_HIDDEN: ReadonlySet<string> = new Set([
  'projects',
  'briefings',
  'schedules',
  'memories',
  'sessionUsage',
]);

function listTeammateRecords(parts: FleetPart[]) {
  const tasks: Record<string, true> = {};
  const repos: Record<string, true> = {};
  for (const part of parts) {
    const viewer = part.teammate?.viewerId;
    if (viewer === undefined) continue;
    for (const task of Object.values(part.state.tasks))
      if (!isHeldBy(task, { id: viewer })) tasks[task.id] = true;
    for (const id of Object.keys(part.state.repos)) repos[id] = true;
  }
  return { teammateTasks: tasks, teammateRepos: repos };
}

function mergeRecords(parts: FleetPart[], key: (typeof FLEET_RECORDS)[number]) {
  const shown = TEAMMATE_HIDDEN.has(key) ? parts.filter((part) => !part.teammate) : parts;
  return Object.assign({}, ...shown.map((part) => part.state[key])) as WireState[typeof key];
}

export function mergeFleetStates(parts: FleetPart[]): FleetState | null {
  const [home] = parts;
  if (!home) return null;
  const owners = new Map<string, string>();
  for (const part of parts) {
    owners.set(part.id, part.id);
    for (const key of FLEET_RECORDS) for (const id of Object.keys(part.state[key])) owners.set(id, part.id);
  }
  const sharedHandles = listSharedHandles(parts);
  if (parts.length === 1 && !home.teammate) return { state: home.state, owners, sharedHandles };
  const own = parts.filter((part) => !part.teammate);
  const state: WireState = {
    ...home.state,
    seq: parts.reduce((total, part) => total + part.state.seq, 0),
    taskNumbers: Object.assign({}, ...parts.map((part) => part.state.taskNumbers)),
    onBehalfActions: own.flatMap((part) => part.state.onBehalfActions),
    presence: mergePresence(own),
    away: mergeKeyed(own, 'away'),
    focusHistory: mergeKeyed(own, 'focusHistory'),
    ...listTeammateRecords(parts),
  };
  for (const key of FLEET_RECORDS) Object.assign(state, { [key]: mergeRecords(parts, key) });
  return { state, owners, sharedHandles };
}

interface FleetTerminalsPart {
  id: string;
  terminals: TerminalsSnapshot;
}

interface FleetTerminals {
  terminals: TerminalsSnapshot | null;
  owners: ReadonlyMap<string, string>;
}

function mergeFleetTerminals(parts: FleetTerminalsPart[]): FleetTerminals {
  const owners = new Map<string, string>();
  for (const part of parts)
    for (const item of [...part.terminals.terminals, ...part.terminals.services])
      owners.set(item.id, part.id);
  const [home] = parts;
  if (!home) return { terminals: null, owners };
  if (parts.length === 1) return { terminals: home.terminals, owners };
  return {
    terminals: {
      home: home.terminals.home,
      terminals: parts.flatMap((part) => part.terminals.terminals),
      services: parts.flatMap((part) => part.terminals.services),
    },
    owners,
  };
}

function resolveTerminalsOwner(terminals: TerminalsSnapshot, owners: ReadonlyMap<string, string>) {
  for (const item of [...terminals.terminals, ...terminals.services]) {
    const owner = owners.get(item.id);
    if (owner) return owner;
  }
  return null;
}

export function resolveFleetStatus(statuses: ConnectionStatus[]): ConnectionStatus {
  if (statuses.includes('open')) return 'open';
  if (statuses.includes('connecting')) return 'connecting';
  return 'closed';
}

function findOwner(value: unknown, owners: ReadonlyMap<string, string>, depth: number): string | null {
  if (typeof value === 'string') return owners.get(value) ?? null;
  if (depth === 0 || value === null || typeof value !== 'object') return null;
  for (const inner of Object.values(value)) {
    const owner = findOwner(inner, owners, depth - 1);
    if (owner) return owner;
  }
  return null;
}

export function resolveCommandOwner(command: UserCommand, owners: ReadonlyMap<string, string>) {
  const { type: _type, ...fields } = command;
  return findOwner(fields, owners, SCAN_DEPTH);
}

export function resolveRequestOwner(url: URL, owners: ReadonlyMap<string, string>) {
  const values = [
    ...url.pathname.split('/').map((segment) =>
      Result.getOrElse(
        Result.try(() => decodeURIComponent(segment)),
        () => segment
      )
    ),
    ...url.searchParams.values(),
  ];
  for (const value of values) {
    const owner = owners.get(value);
    if (owner) return owner;
  }
  return null;
}

interface FleetEntry {
  member: FleetMember;
  view: MachineView;
  release: (() => void)[];
}

const EMPTY_OWNERS: ReadonlyMap<string, string> = new Map();

const SERVED_PATH = /^\/(?!\/)/;

const PATH_BASE = 'http://localhost';

const NO_FLEET_TERMINALS: FleetTerminals = { terminals: null, owners: EMPTY_OWNERS };

const BODY_ROUTED_PREFIX = '/api/services';

function isBodyRouted(request: Request, url: URL) {
  return (
    request.method === 'POST' &&
    url.pathname.startsWith(BODY_ROUTED_PREFIX) &&
    (request.headers.get('content-type') ?? '').includes('json')
  );
}

const decodeRequestJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const readRequestJson = Effect.fn('Fleet.readRequestJson')(function* (request: Request) {
  const text = yield* Effect.option(Effect.tryPromise(() => request.clone().text()));
  return Option.getOrNull(Option.flatMap(text, decodeRequestJson));
});

const NO_SHARED_HANDLES: ReadonlySet<string> = new Set();

export const FLEET_WAIT_MS = 10_000;

function waitForMachines(settle: () => void) {
  const timer = setTimeout(settle, FLEET_WAIT_MS);
  return () => clearTimeout(timer);
}

function isSettled(input: Snapshot, reachable: boolean | undefined, online: boolean | undefined) {
  return !reachable || online === false || input.state !== null;
}

function isReachable(entry: FleetEntry) {
  return isEngineProtocolMatch(entry.member.connection.selectEngine());
}

function resolveRefusedCommand(member: FleetMember) {
  if (member.teammate) return TEAM_SCOPE_MESSAGES.command;
  return member.guest ? SCOPE_MESSAGES.command : resolveUpdateMessage(member.name);
}

function resolveMemberRank(member: FleetMember) {
  if (member.teammate) return 2;
  return member.guest ? 1 : 0;
}

export class Fleet implements ShinsaConnection {
  #entries: FleetEntry[] = [];
  #inputs: Snapshot[] = [];
  #engines: (EngineInfo | null)[] = [];
  #snapshot: Snapshot = { state: null, status: 'closed' };
  #owners: ReadonlyMap<string, string> = EMPTY_OWNERS;
  #parts: (FleetPart & { view: MachineView })[] = [];
  #partResources: (MachineResources | null)[] = [];
  #machinesFrom: FleetPart[] | null = null;
  #machines: MachineChoice[] = NO_MACHINES;
  #unreachable: UnreachableMachine[] = NO_UNREACHABLE_MACHINES;
  #listedUnreachable: UnreachableMachine[] = NO_UNREACHABLE_MACHINES;
  #accessInputs: (RemoteSnapshot | null)[] = [];
  #access: MachineAccess[] = NO_MACHINE_ACCESS;
  #terminalInputs: (TerminalsSnapshot | null)[] = [];
  #terminalMembers: string[] = [];
  #terminals: FleetTerminals = NO_FLEET_TERMINALS;
  readonly #state = createSignal();
  readonly #transcripts = createSignal();
  readonly #accounts = createSignal();
  readonly #surfaces = createSignal();
  readonly #terminalsSignal = createSignal();
  readonly #resources = createSignal();
  readonly #remote = createSignal();
  readonly #teams = createSignal();
  readonly #hostedTeams: TeamFeedSource | null;
  #teamInputs: TeamFeedSnapshot[] = [];
  #teamFeed: TeamFeedSnapshot = NO_TEAM_FEED;
  readonly #wait: (settle: () => void) => () => void;
  #settled = false;
  #stopWaiting: (() => void) | null = null;

  constructor(
    members: FleetMember[],
    unreachable: UnreachableMachine[] = NO_UNREACHABLE_MACHINES,
    hostedTeams: TeamFeedSource | null = null,
    wait: (settle: () => void) => () => void = waitForMachines
  ) {
    for (const member of [...members].sort((a, b) => resolveMemberRank(a) - resolveMemberRank(b)))
      this.#add(member);
    this.#unreachable = unreachable;
    this.#hostedTeams = hostedTeams;
    this.#wait = wait;
    hostedTeams?.subscribe(() => this.#teams.publish());
    this.#listedUnreachable = unreachable;
  }

  get members() {
    return this.#entries.map((entry) => entry.view);
  }

  #add(member: FleetMember) {
    const { connection } = member;
    this.#entries.push({
      member,
      view: {
        id: member.id,
        name: member.name,
        current: member.current === true,
        ...(member.guest ? { guest: true as const } : {}),
        ...(member.handedBy ? { handedBy: member.handedBy } : {}),
        ...(member.teammate ? { teammate: member.teammate } : {}),
      },
      release: [
        connection.subscribe(() => this.#state.publish()),
        connection.subscribeTranscripts(() => this.#transcripts.publish()),
        connection.subscribeAccounts(() => this.#accounts.publish()),
        connection.subscribeSurfaces(() => this.#surfaces.publish()),
        connection.subscribeTerminals(() => this.#terminalsSignal.publish()),
        connection.subscribeResources(() => {
          this.#resources.publish();
          this.#state.publish();
        }),
        connection.subscribeRemote(() => this.#remote.publish()),
        connection.subscribeTeams(() => this.#teams.publish()),
      ],
    });
  }

  #drop(entry: FleetEntry) {
    for (const release of entry.release) release();
    entry.member.close?.();
    this.#entries = this.#entries.filter((candidate) => candidate !== entry);
  }

  #publishMembers() {
    this.#state.publish();
    this.#transcripts.publish();
    this.#remote.publish();
  }

  addMember(member: FleetMember) {
    this.#add(member);
    this.#entries.sort((a, b) => resolveMemberRank(a.member) - resolveMemberRank(b.member));
    member.connection.start();
    this.#publishMembers();
  }

  removeMember(id: string) {
    const entry = this.#entries.find((candidate) => candidate.member.id === id);
    if (!entry) return;
    this.#drop(entry);
    this.#unreachable = [...this.#unreachable, { id: entry.member.id, name: entry.member.name }];
    this.#publishMembers();
  }

  removeMachine = (id: string) => {
    const entry = this.#entries.find((candidate) => candidate.member.id === id);
    if (entry) this.#drop(entry);
    this.#unreachable = this.#unreachable.filter((machine) => machine.id !== id);
    this.#listedUnreachable = this.#listedUnreachable.filter((machine) => machine.id !== id);
    this.#publishMembers();
  };

  get #home() {
    return this.#entries.find(isReachable)?.member.connection ?? null;
  }

  #ownerOf(id: string) {
    this.snapshot();
    return this.#owners.get(id) ?? null;
  }

  #memberOf(machineId: string | null) {
    const reachable = this.#entries.filter(isReachable);
    const found = machineId ? reachable.find((entry) => entry.member.id === machineId) : undefined;
    return found?.member ?? reachable[0]?.member ?? null;
  }

  #relayOf(owner: string | null) {
    if (!owner) return null;
    return (
      this.#entries.find((entry) => entry.member.id === owner && isReachable(entry))?.member.resolveUrl ??
      null
    );
  }

  resolveMediaUrl = (uri: string) => {
    if (!SERVED_PATH.test(uri) || uri.startsWith(TEAM_RELAY_PATH)) return uri;
    this.snapshot();
    const relay = this.#relayOf(resolveRequestOwner(new URL(uri, PATH_BASE), this.#owners));
    return relay ? relay(uri) : uri;
  };

  selectAppOrigin = (id: string) => {
    const owner = this.#ownerOf(id);
    if (!this.#relayOf(owner)) return null;
    return this.#entries.find((entry) => entry.member.id === owner)?.member.appOrigin ?? null;
  };

  #outdatedMember(machineId: string | null | undefined) {
    const found = machineId ? this.#entries.find((entry) => entry.member.id === machineId) : undefined;
    return found && !isReachable(found) ? found.member : null;
  }

  start = () => {
    if (!this.#settled && !this.#stopWaiting) this.#stopWaiting = this.#wait(() => this.#settle());
    for (const entry of this.#entries) entry.member.connection.start();
  };

  #settle() {
    if (this.#settled) return;
    this.#stopWaitingForMachines();
    this.#settled = true;
    this.#inputs = [];
    this.#state.publish();
  }

  #stopWaitingForMachines() {
    this.#stopWaiting?.();
    this.#stopWaiting = null;
  }

  subscribe = (listener: () => void) => this.#state.subscribe(listener);

  snapshot = () => {
    const inputs = this.#entries.map((entry) => entry.member.connection.snapshot());
    const engines = this.#entries.map((entry) => entry.member.connection.selectEngine());
    if (
      inputs.length === this.#inputs.length &&
      inputs.every((input, index) => input === this.#inputs[index]) &&
      engines.every((engine, index) => engine === this.#engines[index])
    )
      return this.#snapshot;
    this.#inputs = inputs;
    this.#engines = engines;
    const reachable = engines.map(isEngineProtocolMatch);
    if (
      !this.#settled &&
      inputs.every((input, index) => isSettled(input, reachable[index], this.#entries[index]?.member.online))
    ) {
      this.#settled = true;
      this.#stopWaitingForMachines();
    }
    const parts = this.#entries.flatMap((entry, index) => {
      const state = inputs[index]?.state;
      if (!(state && reachable[index])) return [];
      const { teammate } = entry.member;
      return [{ id: entry.member.id, state, view: entry.view, ...(teammate ? { teammate } : {}) }];
    });
    const outdated = this.#entries.flatMap((entry, index) =>
      reachable[index] ? [] : [{ id: entry.member.id, name: entry.member.name, outdated: true }]
    );
    this.#listedUnreachable = outdated.length === 0 ? this.#unreachable : [...this.#unreachable, ...outdated];
    const merged = mergeFleetStates(parts);
    this.#parts = parts;
    this.#owners = merged?.owners ?? EMPTY_OWNERS;
    replaceSharedHandles(merged?.sharedHandles ?? NO_SHARED_HANDLES);
    this.#snapshot = {
      state: this.#settled ? (merged?.state ?? null) : null,
      status: resolveFleetStatus(
        inputs.filter((_input, index) => reachable[index]).map((input) => input.status)
      ),
    };
    return this.#snapshot;
  };

  subscribeTranscripts = (listener: () => void) => this.#transcripts.subscribe(listener);

  selectTranscript = (runId: string) =>
    this.#memberOf(this.#ownerOf(runId))?.connection.selectTranscript(runId) ?? NO_ENTRIES;

  watchTranscript = (runId: string) => {
    const member = this.#memberOf(this.#ownerOf(runId));
    return member ? member.connection.watchTranscript(runId) : () => undefined;
  };

  requestTaskDetail = (taskId: string) =>
    this.#memberOf(this.#ownerOf(taskId))?.connection.requestTaskDetail(taskId);

  watchTaskDetail = (taskId: string) => {
    const member = this.#memberOf(this.#ownerOf(taskId));
    return member ? member.connection.watchTaskDetail(taskId) : () => undefined;
  };

  subscribeAccounts = (listener: () => void) => this.#accounts.subscribe(listener);

  selectAccounts = () => this.#home?.selectAccounts() ?? null;

  replaceAccounts = (accounts: Parameters<ShinsaConnection['replaceAccounts']>[0]) =>
    this.#home?.replaceAccounts(accounts);

  subscribeSurfaces = (listener: () => void) => this.#surfaces.subscribe(listener);

  isDesktopConnected = () => this.#entries.some((entry) => entry.member.connection.isDesktopConnected());

  reportPresence = () => {
    for (const entry of this.#entries) entry.member.connection.reportPresence();
  };

  selectAttention = (taskId?: string | null) =>
    this.#memberOf(taskId ? this.#ownerOf(taskId) : null)?.connection.selectAttention() ?? 'nowhere';

  subscribeTerminals = (listener: () => void) => this.#terminalsSignal.subscribe(listener);

  #mergeTerminals() {
    const reachable = this.#entries.filter(isReachable);
    const inputs = reachable.map((entry) => entry.member.connection.selectTerminals());
    const members = reachable.map((entry) => entry.member.id);
    if (
      inputs.length === this.#terminalInputs.length &&
      inputs.every((input, index) => input === this.#terminalInputs[index]) &&
      members.every((id, index) => id === this.#terminalMembers[index])
    )
      return this.#terminals;
    this.#terminalInputs = inputs;
    this.#terminalMembers = members;
    this.#terminals = mergeFleetTerminals(
      reachable.flatMap((entry, index) => {
        const terminals = inputs[index];
        return terminals ? [{ id: entry.member.id, terminals }] : [];
      })
    );
    return this.#terminals;
  }

  selectTerminals = () => this.#mergeTerminals().terminals;

  #terminalOpener(machineId: string | null) {
    const member = this.#memberOf(machineId);
    if (!hasEngineFeature(member?.connection.selectEngine() ?? null, 'remote.terminals')) return null;
    return member?.openTerminal ?? null;
  }

  canOpenTerminals = (projectId: string) => this.#terminalOpener(this.#ownerOf(projectId)) !== null;

  resolveTerminalTransport = (terminalId: string): SocketTransport | null => {
    const open = this.#terminalOpener(this.#mergeTerminals().owners.get(terminalId) ?? null);
    return open ? resolveSocketTransport(() => open(terminalId)) : null;
  };

  replaceTerminals = (terminals: Parameters<ShinsaConnection['replaceTerminals']>[0]) => {
    const reachable = this.#entries.filter(isReachable);
    const owner =
      resolveTerminalsOwner(terminals, this.#mergeTerminals().owners) ??
      (reachable.length === 1 ? (reachable[0]?.member.id ?? null) : null);
    reachable.find((entry) => entry.member.id === owner)?.member.connection.replaceTerminals(terminals);
  };

  subscribeResources = (listener: () => void) => this.#resources.subscribe(listener);

  selectResources = () => this.#home?.selectResources() ?? null;

  subscribeRemote = (listener: () => void) => this.#remote.subscribe(listener);

  selectRemote = () => this.#home?.selectRemote() ?? null;

  replaceRemote = (remote: Parameters<ShinsaConnection['replaceRemote']>[0]) =>
    this.#home?.replaceRemote(remote);

  subscribeTeams = (listener: () => void) => this.#teams.subscribe(listener);

  selectTeams = () => {
    const inputs = [
      ...this.#entries.map((entry) => entry.member.connection.selectTeams()),
      ...(this.#hostedTeams ? [this.#hostedTeams.snapshot()] : []),
    ];
    const same =
      inputs.length === this.#teamInputs.length &&
      inputs.every((input, index) => input === this.#teamInputs[index]);
    if (same) return this.#teamFeed;
    this.#teamInputs = inputs;
    this.#teamFeed = mergeTeamFeeds(inputs);
    return this.#teamFeed;
  };

  selectMachine = (id: string) => {
    const owner = this.#ownerOf(id);
    const view = this.#entries.find((entry) => entry.member.id === owner)?.view ?? null;
    if (view?.guest || view?.teammate) return view;
    return this.#entries.length + this.#unreachable.length < 2 ? null : view;
  };

  listMachines = () => {
    this.snapshot();
    const parts = this.#parts;
    const resources = parts.map((part) => this.#memberOf(part.id)?.connection.selectResources() ?? null);
    const same =
      this.#machinesFrom === parts &&
      resources.every((reported, index) => reported === this.#partResources[index]);
    if (same) return this.#machines;
    this.#machinesFrom = parts;
    this.#partResources = resources;
    this.#machines =
      parts.length === 0
        ? NO_MACHINES
        : parts.map((part, index) => ({
            ...part.view,
            state: part.state,
            resources: resources[index] ?? null,
          }));
    return this.#machines;
  };

  listUnreachableMachines = () => {
    this.snapshot();
    return this.#listedUnreachable;
  };

  isEveryMachineOutdated() {
    this.snapshot();
    return this.#entries.length > 0 && !this.#entries.some(isReachable);
  }

  selectEngine = (id?: string | null) => {
    const member = this.#memberOf(id ? this.#ownerOf(id) : null);
    return member?.connection.selectEngine() ?? null;
  };

  listMachineAccess = () => {
    const remotes = this.#entries.map((entry) => entry.member.connection.selectRemote());
    const same =
      remotes.length === this.#accessInputs.length &&
      remotes.every((remote, index) => remote === this.#accessInputs[index]);
    if (same) return this.#access;
    this.#accessInputs = remotes;
    this.#access = this.#entries.map((entry, index) => ({
      id: entry.view.id,
      name: entry.view.name,
      remote: remotes[index] ?? null,
    }));
    return this.#access;
  };

  command = (command: UserCommand, machineId?: string | null) => {
    this.snapshot();
    const outdated = this.#outdatedMember(machineId);
    if (outdated) return Promise.reject(new Error(describeOutdatedMachine(outdated.name)));
    const member = this.#memberOf(machineId ?? resolveCommandOwner(command, this.#owners));
    if (!member) return Promise.reject(new Error(NO_MACHINE_CONNECTED));
    if (!selectEngineCommands(member.connection.selectEngine()).has(command.type))
      return Promise.reject(new Error(resolveRefusedCommand(member)));
    return member.connection.command(command);
  };

  fetch = (request: Request) => {
    this.snapshot();
    const url = new URL(request.url);
    const terminalOwners = this.#mergeTerminals().owners;
    const owner = resolveRequestOwner(url, this.#owners) ?? resolveRequestOwner(url, terminalOwners);
    const routed =
      owner || !isBodyRouted(request, url)
        ? Effect.succeed(owner)
        : Effect.map(
            readRequestJson(request),
            (body) => findOwner(body, this.#owners, SCAN_DEPTH) ?? findOwner(body, terminalOwners, SCAN_DEPTH)
          );
    return runApp(
      Effect.flatMap(routed, (machineId) => {
        const member = this.#memberOf(machineId);
        if (!member) return Effect.fail(new NoMachineConnected({ message: NO_MACHINE_CONNECTED }));
        return Effect.promise(() => member.fetch(request));
      })
    );
  };

  reset = () => {
    for (const entry of this.#entries) entry.member.connection.reset();
  };

  flush = () => {
    for (const entry of this.#entries) entry.member.connection.flush();
  };

  close() {
    this.#stopWaitingForMachines();
    for (const entry of [...this.#entries]) this.#drop(entry);
  }
}
