import {
  hasEngineFeature,
  type RemoteSnapshot,
  type RemoteTeam,
  type RemoteUser,
  type TeamFeedSnapshot,
  resolveTeamRelayPath,
  resolveTeamRelaySocketPath,
} from '@shinsa/core';
import type { TeamRelayEntry } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import {
  Connection,
  connection,
  replaceConnection,
  resolveSocketTransport,
  type ShinsaConnection,
  type TeammateMachine,
} from '@/lib/connection/socket.ts';
import { Fleet, type FleetMember } from '@/lib/remote/fleet.ts';
import { forkApp, PAGE_TRANSPORT, replaceAppTransport, resolveAppTransport } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import type { SocketTransport } from '@/lib/runtime/socket/schema.ts';
import { TERMINAL_SOCKET_PATH } from '@/lib/terminal/terminal-socket/schema.ts';
import { resolveTeammateScopes } from './scopes.ts';

type Origin = Pick<Location, 'protocol' | 'host'>;

const requestRelays = Effect.gen(function* () {
  const engine = yield* EngineClient;
  return (yield* engine.teams.relays()).relays;
});

export interface RelayTarget {
  entry: TeamRelayEntry;
  teammate: TeammateMachine;
  online: boolean;
}

export interface RelayMemberOptions {
  origin?: Origin;
  openSocket?: (url: string) => WebSocket;
  send?: (request: Request) => Promise<Response>;
  createConnection?: (transport: SocketTransport) => Connection;
}

export interface LocalRelayOptions extends RelayMemberOptions {
  local: ShinsaConnection;
  onFleet: (fleet: Fleet) => void;
  requestRelays?: typeof requestRelays;
}

function resolveSocketUrl(origin: Origin, path: string) {
  return `${origin.protocol === 'https:' ? 'wss' : 'ws'}://${origin.host}${path}`;
}

function openWebSocket(url: string) {
  return new WebSocket(url);
}

function sendRequest(request: Request) {
  return globalThis.fetch(request);
}

export function resolveRelayRequest(request: Request, instanceId: string) {
  const url = new URL(request.url);
  url.pathname = `${resolveTeamRelayPath(instanceId)}${url.pathname}`;
  return new Request(url, request);
}

function selectUser(team: RemoteTeam, userId: string): RemoteUser | null {
  if (team.owner.id === userId) return team.owner;
  return team.members.find((member) => member.user.id === userId)?.user ?? null;
}

export function resolveRelayTargets(
  entries: readonly TeamRelayEntry[],
  remote: Pick<RemoteSnapshot, 'owner' | 'teams'>
): RelayTarget[] {
  const viewerId = remote.owner;
  if (!viewerId) return [];
  const teams = remote.teams.flatMap((entry) => (entry.team ? [entry.team] : []));
  return entries.flatMap((entry) => {
    const team = teams.find((candidate) => candidate.id === entry.teamId);
    const owner = team && selectUser(team, entry.userId);
    if (!(team && owner)) return [];
    const machine = team.machines.find((candidate) => candidate.id === entry.instanceId);
    return [
      {
        entry,
        teammate: { owner, viewerId, scopes: resolveTeammateScopes(teams, entry.instanceId, viewerId) },
        online: machine?.online ?? false,
      },
    ];
  });
}

export function createRelayMember(target: RelayTarget, options: RelayMemberOptions = {}): FleetMember {
  const { entry } = target;
  const url = resolveSocketUrl(options.origin ?? location, resolveTeamRelaySocketPath(entry.instanceId));
  const openSocket = options.openSocket ?? openWebSocket;
  const transport = resolveSocketTransport(() => openSocket(url));
  const relayed = options.createConnection?.(transport) ?? new Connection({ transport });
  const send = options.send ?? sendRequest;
  return {
    id: entry.instanceId,
    name: entry.name,
    online: target.online,
    teammate: target.teammate,
    connection: relayed,
    fetch: (request) => send(resolveRelayRequest(request, entry.instanceId)),
    resolveUrl: (path) => `${resolveTeamRelayPath(entry.instanceId)}${path}`,
    appOrigin: entry.appOrigin,
    close: () => relayed.stop(),
  };
}

export function createLocalMember(
  local: ShinsaConnection,
  remote: Pick<RemoteSnapshot, 'instanceId' | 'machineName'> & { instanceId: string },
  options: RelayMemberOptions = {}
): FleetMember {
  const origin = options.origin ?? location;
  const openSocket = options.openSocket ?? openWebSocket;
  return {
    id: remote.instanceId,
    name: remote.machineName,
    current: true,
    online: true,
    connection: local,
    fetch: options.send ?? sendRequest,
    openTerminal: (terminalId) =>
      openSocket(resolveSocketUrl(origin, `${TERMINAL_SOCKET_PATH}${encodeURIComponent(terminalId)}`)),
  };
}

function serializeTarget(target: RelayTarget) {
  return JSON.stringify([target.entry, target.teammate]);
}

function serializeTeam(team: RemoteTeam | null) {
  if (!team) return null;
  const machines = team.machines.map((machine) => [machine.id, machine.userId, machine.name, machine.online]);
  return [
    team.id,
    team.owner.id,
    team.members.map((member) => member.user.id),
    machines,
    team.scopes,
    team.overrides,
  ];
}

function serializeTeams(remote: RemoteSnapshot, feed: TeamFeedSnapshot) {
  return JSON.stringify([
    remote.instanceId,
    remote.owner,
    remote.teams.map((entry) => serializeTeam(entry.team)),
    feed.machines.map((machine) => [machine.teamId, machine.instanceId, machine.status]),
  ]);
}

export class LocalRelays {
  readonly #options: LocalRelayOptions;
  #fleet: Fleet | null = null;
  #targets = new Map<string, string>();
  #asked: string | null = null;
  #round = 0;

  constructor(options: LocalRelayOptions) {
    this.#options = options;
  }

  get fleet() {
    return this.#fleet;
  }

  start() {
    const { local } = this.#options;
    const sync = () => this.#sync();
    const release = [local.subscribe(sync), local.subscribeRemote(sync), local.subscribeTeams(sync)];
    sync();
    return () => {
      for (const step of release) step();
    };
  }

  #sync() {
    const { local } = this.#options;
    const remote = local.selectRemote();
    if (!(remote?.instanceId && hasEngineFeature(local.selectEngine(), 'team-relay'))) return;
    const asked = serializeTeams(remote, local.selectTeams());
    if (asked === this.#asked) return;
    this.#asked = asked;
    const round = ++this.#round;
    forkApp(
      Effect.match(this.#options.requestRelays ?? requestRelays, {
        onSuccess: (entries) => {
          if (round === this.#round) this.#apply(resolveRelayTargets(entries, remote), remote);
        },
        onFailure: () => {
          if (round === this.#round) this.#asked = null;
        },
      })
    );
  }

  #apply(targets: RelayTarget[], remote: RemoteSnapshot) {
    const fleet = this.#fleet;
    if (!fleet) {
      if (targets.length === 0 || !remote.instanceId) return;
      const local = createLocalMember(
        this.#options.local,
        { instanceId: remote.instanceId, machineName: remote.machineName },
        this.#options
      );
      this.#fleet = new Fleet([local, ...targets.map((target) => createRelayMember(target, this.#options))]);
      this.#targets = new Map(targets.map((target) => [target.entry.instanceId, serializeTarget(target)]));
      this.#options.onFleet(this.#fleet);
      return;
    }
    const next = new Map(targets.map((target) => [target.entry.instanceId, serializeTarget(target)]));
    for (const [id, signature] of this.#targets) if (next.get(id) !== signature) fleet.removeMachine(id);
    for (const target of targets)
      if (this.#targets.get(target.entry.instanceId) !== next.get(target.entry.instanceId))
        fleet.addMember(createRelayMember(target, this.#options));
    this.#targets = next;
  }

  stop() {
    this.#round++;
    this.#fleet?.close();
    this.#fleet = null;
  }
}

export function startLocalRelays(onSwitch: () => void, options: Partial<LocalRelayOptions> = {}) {
  const relays = new LocalRelays({
    local: connection,
    ...options,
    onFleet: (fleet) => {
      replaceConnection(fleet);
      replaceAppTransport(resolveAppTransport((input, init) => fleet.fetch(new Request(input, init))));
      onSwitch();
    },
  });
  const stop = relays.start();
  return () => {
    stop();
    if (!relays.fleet) return;
    relays.stop();
    replaceAppTransport(PAGE_TRANSPORT);
    replaceConnection(null);
  };
}
