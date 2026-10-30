import type { UserCommand, WireState } from '@shinsa/core';
import {
  type ConnectionStatus,
  type MachineView,
  NO_ENTRIES,
  type ShinsaConnection,
  type Snapshot,
} from '@/lib/connection/socket.ts';
import { createSignal } from '@/lib/signal.ts';
import { replaceSharedHandles } from '@/router.ts';

export interface FleetMember {
  id: string;
  name: string;
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
  for (const part of parts)
    for (const key of FLEET_RECORDS) for (const id of Object.keys(part.state[key])) owners.set(id, part.id);
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

export class Fleet implements ShinsaConnection {
  #entries: FleetEntry[] = [];
  #inputs: Snapshot[] = [];
  #snapshot: Snapshot = { state: null, status: 'closed' };
  #owners: ReadonlyMap<string, string> = EMPTY_OWNERS;
  readonly #state = createSignal();
  readonly #transcripts = createSignal();
  readonly #accounts = createSignal();
  readonly #surfaces = createSignal();
  readonly #terminals = createSignal();

  constructor(members: FleetMember[]) {
    for (const member of members) this.#add(member);
  }

  get members() {
    return this.#entries.map((entry) => entry.view);
  }

  #add(member: FleetMember) {
    const { connection } = member;
    this.#entries.push({
      member,
      view: { id: member.id, name: member.name },
      release: [
        connection.subscribe(() => this.#state.publish()),
        connection.subscribeTranscripts(() => this.#transcripts.publish()),
        connection.subscribeAccounts(() => this.#accounts.publish()),
        connection.subscribeSurfaces(() => this.#surfaces.publish()),
        connection.subscribeTerminals(() => this.#terminals.publish()),
      ],
    });
  }

  removeMember(id: string) {
    const entry = this.#entries.find((candidate) => candidate.member.id === id);
    if (!entry) return;
    for (const release of entry.release) release();
    this.#entries = this.#entries.filter((candidate) => candidate !== entry);
    this.#state.publish();
    this.#transcripts.publish();
  }

  get #home() {
    return this.#entries[0]?.member.connection ?? null;
  }

  #ownerOf(id: string) {
    this.snapshot();
    return this.#owners.get(id) ?? null;
  }

  #memberOf(machineId: string | null) {
    const found = machineId ? this.#entries.find((entry) => entry.member.id === machineId) : undefined;
    return found?.member ?? this.#entries[0]?.member ?? null;
  }

  start = () => {
    for (const entry of this.#entries) entry.member.connection.start();
  };

  subscribe = (listener: () => void) => this.#state.subscribe(listener);

  snapshot = () => {
    const inputs = this.#entries.map((entry) => entry.member.connection.snapshot());
    if (
      inputs.length === this.#inputs.length &&
      inputs.every((input, index) => input === this.#inputs[index])
    )
      return this.#snapshot;
    this.#inputs = inputs;
    const parts = this.#entries.flatMap((entry, index) => {
      const state = inputs[index]?.state;
      return state ? [{ id: entry.member.id, state }] : [];
    });
    const merged = mergeFleetStates(parts);
    this.#owners = merged?.owners ?? EMPTY_OWNERS;
    replaceSharedHandles(merged?.sharedHandles ?? NO_SHARED_HANDLES);
    this.#snapshot = {
      state: merged?.state ?? null,
      status: resolveFleetStatus(inputs.map((input) => input.status)),
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

  selectMachine = (id: string) => {
    if (this.#entries.length < 2) return null;
    const owner = this.#ownerOf(id);
    return this.#entries.find((entry) => entry.member.id === owner)?.view ?? null;
  };

  command = (command: UserCommand) => {
    this.snapshot();
    const member = this.#memberOf(resolveCommandOwner(command, this.#owners));
    if (!member) return Promise.reject(new Error('No Mac is connected.'));
    return member.connection.command(command);
  };

  fetch = (request: Request) => {
    this.snapshot();
    const member = this.#memberOf(resolveRequestOwner(new URL(request.url), this.#owners));
    if (!member) return Promise.reject(new Error('No Mac is connected.'));
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
