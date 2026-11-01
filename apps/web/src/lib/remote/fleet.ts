import {
  type EngineInfo,
  isEngineProtocolMatch,
  type MachineResources,
  NO_TEAM_FEED,
  type RemoteSnapshot,
  type RemoteUser,
  SCOPE_MESSAGES,
  type TeamFeedSnapshot,
  type UserCommand,
  type WireState,
} from '@shinsa/core';
import {
  type ConnectionStatus,
  type MachineAccess,
  type MachineChoice,
  type MachineView,
  NO_ENTRIES,
  NO_MACHINE_ACCESS,
  NO_MACHINES,
  NO_UNREACHABLE_MACHINES,
  resolveUpdateMessage,
  type ShinsaConnection,
  type Snapshot,
  selectEngineCommands,
  type UnreachableMachine,
} from '@/lib/connection/socket.ts';
import { describeOutdatedMachine } from '@/lib/remote/mode.ts';
import { createSignal } from '@/lib/signal.ts';
import { mergeTeamFeeds, type TeamFeedSource } from '@/lib/teams/feeds.ts';
import { replaceSharedHandles } from '@/router.ts';

export interface FleetMember {
  id: string;
  name: string;
  current?: boolean;
  guest?: true;
  handedBy?: RemoteUser;
  connection: ShinsaConnection;
  fetch: (request: Request) => Promise<Response>;
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
}

export interface FleetState {
  state: WireState;
  owners: ReadonlyMap<string, string>;
  sharedHandles: ReadonlySet<string>;
}

function mergeRecords(parts: FleetPart[], key: (typeof FLEET_RECORDS)[number]) {
  return Object.assign({}, ...parts.map((part) => part.state[key])) as WireState[typeof key];
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

export function mergeFleetStates(parts: FleetPart[]): FleetState | null {
  const [home] = parts;
  if (!home) return null;
  const owners = new Map<string, string>();
  for (const part of parts) {
    owners.set(part.id, part.id);
    for (const key of FLEET_RECORDS) for (const id of Object.keys(part.state[key])) owners.set(id, part.id);
  }
  const sharedHandles = listSharedHandles(parts);
  if (parts.length === 1) return { state: home.state, owners, sharedHandles };
  const state: WireState = {
    ...home.state,
    seq: parts.reduce((total, part) => total + part.state.seq, 0),
    taskNumbers: Object.assign({}, ...parts.map((part) => part.state.taskNumbers)),
    onBehalfActions: parts.flatMap((part) => part.state.onBehalfActions),
  };
  for (const key of FLEET_RECORDS) Object.assign(state, { [key]: mergeRecords(parts, key) });
  return { state, owners, sharedHandles };
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
    ...url.pathname.split('/').map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    }),
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

const NO_SHARED_HANDLES: ReadonlySet<string> = new Set();

function isReachable(entry: FleetEntry) {
  return isEngineProtocolMatch(entry.member.connection.selectEngine());
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
  readonly #state = createSignal();
  readonly #transcripts = createSignal();
  readonly #accounts = createSignal();
  readonly #surfaces = createSignal();
  readonly #terminals = createSignal();
  readonly #resources = createSignal();
  readonly #remote = createSignal();
  readonly #teams = createSignal();
  readonly #hostedTeams: TeamFeedSource | null;
  #teamInputs: TeamFeedSnapshot[] = [];
  #teamFeed: TeamFeedSnapshot = NO_TEAM_FEED;

  constructor(
    members: FleetMember[],
    unreachable: UnreachableMachine[] = NO_UNREACHABLE_MACHINES,
    hostedTeams: TeamFeedSource | null = null
  ) {
    for (const member of [...members].sort((a, b) => Number(a.guest === true) - Number(b.guest === true)))
      this.#add(member);
    this.#unreachable = unreachable;
    this.#hostedTeams = hostedTeams;
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
      },
      release: [
        connection.subscribe(() => this.#state.publish()),
        connection.subscribeTranscripts(() => this.#transcripts.publish()),
        connection.subscribeAccounts(() => this.#accounts.publish()),
        connection.subscribeSurfaces(() => this.#surfaces.publish()),
        connection.subscribeTerminals(() => this.#terminals.publish()),
        connection.subscribeResources(() => {
          this.#resources.publish();
          this.#state.publish();
        }),
        connection.subscribeRemote(() => this.#remote.publish()),
        connection.subscribeTeams(() => this.#teams.publish()),
      ],
    });
  }

  removeMember(id: string) {
    const entry = this.#entries.find((candidate) => candidate.member.id === id);
    if (!entry) return;
    for (const release of entry.release) release();
    this.#entries = this.#entries.filter((candidate) => candidate !== entry);
    this.#unreachable = [...this.#unreachable, { id: entry.member.id, name: entry.member.name }];
    this.#state.publish();
    this.#transcripts.publish();
  }

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

  #outdatedMember(machineId: string | null | undefined) {
    const found = machineId ? this.#entries.find((entry) => entry.member.id === machineId) : undefined;
    return found && !isReachable(found) ? found.member : null;
  }

  start = () => {
    for (const entry of this.#entries) entry.member.connection.start();
  };

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
    const parts = this.#entries.flatMap((entry, index) => {
      const state = inputs[index]?.state;
      return state && reachable[index] ? [{ id: entry.member.id, state, view: entry.view }] : [];
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
      state: merged?.state ?? null,
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

  subscribeTerminals = (listener: () => void) => this.#terminals.subscribe(listener);

  selectTerminals = () => this.#home?.selectTerminals() ?? null;

  replaceTerminals = (terminals: Parameters<ShinsaConnection['replaceTerminals']>[0]) =>
    this.#home?.replaceTerminals(terminals);

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
    if (view?.guest) return view;
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
    if (!member) return Promise.reject(new Error('No machine is connected.'));
    if (!selectEngineCommands(member.connection.selectEngine()).has(command.type))
      return Promise.reject(
        new Error(member.guest ? SCOPE_MESSAGES.command : resolveUpdateMessage(member.name))
      );
    return member.connection.command(command);
  };

  fetch = (request: Request) => {
    this.snapshot();
    const member = this.#memberOf(resolveRequestOwner(new URL(request.url), this.#owners));
    if (!member) return Promise.reject(new Error('No machine is connected.'));
    return member.fetch(request);
  };

  reset = () => {
    for (const entry of this.#entries) entry.member.connection.reset();
  };

  flush = () => {
    for (const entry of this.#entries) entry.member.connection.flush();
  };

  close() {
    for (const entry of this.#entries) for (const release of entry.release) release();
    this.#entries = [];
  }
}
