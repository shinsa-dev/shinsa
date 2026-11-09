import { Effect, Option } from 'effect';
import { isRecord, parseJsonRecord } from '../domain/records.ts';
import { DAY_MS } from '../domain/time.ts';
import { ACCESS_PRESETS } from '../scopes/index.ts';
import { ACCESS_SCOPES, ACTION_SCOPES, type AccessScopes, type ActionScope } from '../scopes/schema.ts';
import type { TeamTask } from '../share/teams.ts';
import { encodeText, hasBytes, parseBase64Url, serializeBase64Url, URL_SAFE_SEGMENT } from './bytes.ts';
import {
  REMOTE_APP_ORIGIN,
  REMOTE_CONNECT_PARAM,
  REMOTE_PATHS,
  type RemoteTeam,
  type TeamAction,
} from './contract.ts';
import { REMOTE_PROTOCOL_VERSION } from './handshake.ts';
import { parseSigningPublicKey, serializePublicKey } from './keys.ts';
import { deriveChannelSessionKey, signChannelProof, verifyChannelProof } from './share-channel.ts';

const TEAM_HELLO_LABEL = 'shinsa-team-hello-v1';

const TEAM_WELCOME_LABEL = 'shinsa-team-welcome-v1';

const TEAM_SESSION_LABEL = 'shinsa-team-v1 server-to-client';

const SNAPSHOT_LABEL = 'shinsa-team-snapshot-v1';

const SNAPSHOT_SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' } as const;

export const TEAM_KEY_BYTES = 32;

export const TEAM_SNAPSHOT_TTL_MS = 30 * DAY_MS;

export const TEAM_CHANNEL_PATH = '/team';

export const TEAM_TASKS_PATH = '/api/teams/tasks';

export const TEAM_VIEW_PATH = '/api/teams/view';

export const TEAM_RELAY_PATH = '/api/teams/relay';

export const TEAM_RELAY_SOCKET_PATH = '/ws/teams/relay';

const TEAM_RELAY_PATTERN = /^\/api\/teams\/relay\/([^/]+)(\/api\/.*)$/;

const TEAM_RELAY_SOCKET_PATTERN = /^\/ws\/teams\/relay\/([^/]+)$/;

export interface TeamRelayTarget {
  instanceId: string;
  path: string;
}

export const TEAM_REFUSALS = {
  team: 'That machine has left this team.',
  key: 'That machine has no key for this team. Its owner can rejoin from the team’s join link.',
  member:
    'That machine does not list you in this team yet. It catches up the next time it reaches Shinsa Cloud.',
  mismatch: 'Your key for this team does not match that machine’s. Open the team’s join link again.',
  task: 'This task is no longer shown to the team.',
} as const;

export const DEFAULT_TEAM_SCOPES: AccessScopes = ACCESS_PRESETS.collaborate;

type TeamPeople = Pick<RemoteTeam, 'owner' | 'members'>;

export function isTeamPerson(team: TeamPeople, userId: string) {
  return team.owner.id === userId || team.members.some((member) => member.user.id === userId);
}

export function resolveMemberScopes(
  team: TeamPeople & Pick<RemoteTeam, 'scopes' | 'overrides'>,
  userId: string
): AccessScopes {
  if (team.owner.id === userId) return ACCESS_SCOPES;
  return team.overrides.find((entry) => entry.userId === userId)?.scopes ?? team.scopes;
}

export const MACHINE_EXTRA_SCOPES: readonly ActionScope[] = ACTION_SCOPES.filter((scope) => scope !== 'fork');

export function listMachineExtraScopes(scopes: AccessScopes): AccessScopes {
  return MACHINE_EXTRA_SCOPES.filter((scope) => scopes.includes(scope));
}

export function mergeScopes(base: AccessScopes, extra: AccessScopes): AccessScopes {
  return ACCESS_SCOPES.filter((scope) => base.includes(scope) || extra.includes(scope));
}

export interface TeamJoinFragment {
  teamId: string;
  invite: string;
  key: string;
}

export type TeamView = { kind: 'list' } | { kind: 'task'; taskId: string };

export interface TeamHello {
  type: 'team-hello';
  version: number;
  team: string;
  view: TeamView;
  ephemeral: string;
  proof: string;
  watcher?: 'machine';
}

export interface TeamKeys {
  team: string;
  view: TeamView;
  clientEphemeral: string;
  serverEphemeral: string;
}

export interface TeamSnapshotBody {
  teamId: string;
  instanceId: string;
  tasks: TeamTask[];
  updatedAt: number;
}

export interface TeamSnapshot {
  body: string;
  signature: string;
}

export const TEAM_PRESENCE_STATUSES = ['online', 'away', 'offline'] as const;

export type TeamPresenceStatus = (typeof TEAM_PRESENCE_STATUSES)[number];

export interface TeamPresence {
  userId: string;
  status: TeamPresenceStatus;
  seenAt: number | null;
}

export interface TeamListView {
  tasks: TeamTask[];
  machineKey: string;
  grant?: string;
  updatedAt: number;
  snapshot?: TeamSnapshot;
  held?: TeamSnapshot[];
  presence?: TeamPresence[];
}

function resolvePresenceRank(status: TeamPresenceStatus) {
  return TEAM_PRESENCE_STATUSES.length - TEAM_PRESENCE_STATUSES.indexOf(status);
}

function resolveLaterSeen(left: number | null, right: number | null) {
  if (left === null) return right;
  return right === null ? left : Math.max(left, right);
}

export function mergeTeamPresence(reports: readonly (readonly TeamPresence[])[]) {
  const merged = new Map<string, TeamPresence>();
  for (const entry of reports.flat()) {
    const known = merged.get(entry.userId);
    const status =
      known && resolvePresenceRank(known.status) > resolvePresenceRank(entry.status)
        ? known.status
        : entry.status;
    merged.set(entry.userId, {
      userId: entry.userId,
      status,
      seenAt: resolveLaterSeen(known?.seenAt ?? null, entry.seenAt),
    });
  }
  return merged;
}

export type TeamFeedStatus = 'connecting' | 'live' | 'offline' | 'refused';

export interface TeamFeedMachine {
  teamId: string;
  instanceId: string;
  name: string;
  userId: string;
  status: TeamFeedStatus;
  reason: string | null;
  updatedAt?: number;
  presence?: TeamPresence[];
  asking?: boolean;
}

export interface TeamFeedTask extends TeamTask {
  teamId: string;
  instanceId: string;
}

export interface TeamFeedSnapshot {
  machines: TeamFeedMachine[];
  tasks: TeamFeedTask[];
}

export const NO_TEAM_FEED: TeamFeedSnapshot = { machines: [], tasks: [] };

export function resolveTeamPresence(feed: TeamFeedSnapshot, teamId: string | null = null) {
  const machines = feed.machines.filter((machine) => teamId === null || machine.teamId === teamId);
  return mergeTeamPresence(
    machines.map((machine) =>
      machine.status === 'live'
        ? (machine.presence ?? [])
        : [{ userId: machine.userId, status: 'offline' as const, seenAt: machine.updatedAt ?? null }]
    )
  );
}

export interface TeamViewTarget {
  teamId: string;
  instanceId: string;
  taskId: string;
}

export function isTeamKey(key: string) {
  return hasBytes(key, TEAM_KEY_BYTES);
}

export function serializeTeamJoinFragment(fragment: TeamJoinFragment) {
  return [fragment.teamId, fragment.invite, fragment.key].join('.');
}

export function parseTeamJoinFragment(fragment: string): Option.Option<TeamJoinFragment> {
  const parts = fragment.replace(/^#/, '').split('.');
  if (parts.length !== 3 || parts.some((part) => !URL_SAFE_SEGMENT.test(part))) return Option.none();
  const [teamId, invite, key] = parts as [string, string, string];
  return isTeamKey(key) ? Option.some({ teamId, invite, key }) : Option.none();
}

export function parseTeamJoinUrl(url: string): Option.Option<TeamJoinFragment> {
  if (!URL.canParse(url.trim())) return Option.none();
  const parsed = new URL(url.trim());
  if (parsed.pathname !== REMOTE_PATHS.teamJoinPage) return Option.none();
  return parseTeamJoinFragment(parsed.hash);
}

export function resolveTeamJoinUrl(fragment: TeamJoinFragment, origin: string = REMOTE_APP_ORIGIN) {
  return `${origin}${REMOTE_PATHS.teamJoinPage}#${serializeTeamJoinFragment(fragment)}`;
}

export function resolveTeamPath(teamId: string) {
  return `${REMOTE_PATHS.teams}/${encodeURIComponent(teamId)}`;
}

export function resolveTeamConnectPath(teamId: string) {
  return `${resolveTeamPath(teamId)}/connect`;
}

export function resolveTeamLeavePath(teamId: string) {
  return `${resolveTeamPath(teamId)}/leave`;
}

export function resolveMachineTeamPath(teamId: string, action: TeamAction) {
  return `${REMOTE_PATHS.machineTeams}/${encodeURIComponent(teamId)}/${action}`;
}

export function resolveTeamChannelUrl(tunnelUrl: string, token: string) {
  return `${tunnelUrl}${TEAM_CHANNEL_PATH}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`;
}

export function resolveTeamViewPath(target: TeamViewTarget) {
  const query = new URLSearchParams({ team: target.teamId, machine: target.instanceId, task: target.taskId });
  return `${TEAM_VIEW_PATH}?${query.toString()}`;
}

export function parseTeamViewTarget(url: URL): Option.Option<TeamViewTarget> {
  const teamId = url.searchParams.get('team');
  const instanceId = url.searchParams.get('machine');
  const taskId = url.searchParams.get('task');
  if (!(teamId && instanceId && taskId)) return Option.none();
  if (![teamId, instanceId, taskId].every((part) => URL_SAFE_SEGMENT.test(part))) return Option.none();
  return Option.some({ teamId, instanceId, taskId });
}

export function resolveTeamRelayPath(instanceId: string) {
  return `${TEAM_RELAY_PATH}/${encodeURIComponent(instanceId)}`;
}

export function resolveTeamRelaySocketPath(instanceId: string) {
  return `${TEAM_RELAY_SOCKET_PATH}/${encodeURIComponent(instanceId)}`;
}

export function parseTeamRelayPath(pathname: string): Option.Option<TeamRelayTarget> {
  const match = TEAM_RELAY_PATTERN.exec(pathname);
  if (!(match?.[1] && match[2] && URL_SAFE_SEGMENT.test(match[1]))) return Option.none();
  return Option.some({ instanceId: match[1], path: match[2] });
}

export function parseTeamRelaySocketPath(pathname: string) {
  const instanceId = TEAM_RELAY_SOCKET_PATTERN.exec(pathname)?.[1];
  return instanceId && URL_SAFE_SEGMENT.test(instanceId) ? Option.some(instanceId) : Option.none<string>();
}

function serializeTeamView(view: TeamView) {
  return view.kind === 'list' ? 'list' : `task:${view.taskId}`;
}

function readTeamView(value: unknown): TeamView | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'list') return { kind: 'list' };
  if (value.kind === 'task' && typeof value.taskId === 'string' && URL_SAFE_SEGMENT.test(value.taskId))
    return { kind: 'task', taskId: value.taskId };
  return null;
}

function listHelloParts(team: string, view: TeamView, ephemeral: string) {
  return [TEAM_HELLO_LABEL, team, serializeTeamView(view), ephemeral];
}

function listTeamWelcomeParts(keys: TeamKeys) {
  return [
    TEAM_WELCOME_LABEL,
    keys.team,
    serializeTeamView(keys.view),
    keys.clientEphemeral,
    keys.serverEphemeral,
  ];
}

export const createTeamHello = Effect.fn('createTeamHello')(function* (
  team: string,
  key: string,
  view: TeamView,
  ephemeral: CryptoKey,
  watcher: TeamHello['watcher'] = undefined
) {
  const serialized = yield* serializePublicKey(ephemeral);
  const hello: TeamHello = {
    type: 'team-hello',
    version: REMOTE_PROTOCOL_VERSION,
    team,
    view,
    ephemeral: serialized,
    proof: yield* signChannelProof(key, listHelloParts(team, view, serialized)),
    ...(watcher ? { watcher } : {}),
  };
  return hello;
});

export function parseTeamHello(text: string): Option.Option<TeamHello> {
  const fields = Option.getOrUndefined(parseJsonRecord(text));
  if (fields?.type !== 'team-hello' || fields.version !== REMOTE_PROTOCOL_VERSION) return Option.none();
  const view = readTeamView(fields.view);
  const { team, ephemeral, proof } = fields;
  if (!(view && typeof team === 'string' && typeof ephemeral === 'string' && typeof proof === 'string'))
    return Option.none();
  const hello: TeamHello = {
    type: 'team-hello',
    version: REMOTE_PROTOCOL_VERSION,
    team,
    view,
    ephemeral,
    proof,
  };
  return Option.some(fields.watcher === 'machine' ? { ...hello, watcher: 'machine' } : hello);
}

export function verifyTeamHello(key: string, hello: TeamHello) {
  return verifyChannelProof(key, hello.proof, listHelloParts(hello.team, hello.view, hello.ephemeral));
}

export const createTeamWelcome = Effect.fn('createTeamWelcome')(function* (key: string, keys: TeamKeys) {
  return {
    type: 'welcome' as const,
    ephemeral: keys.serverEphemeral,
    proof: yield* signChannelProof(key, listTeamWelcomeParts(keys)),
  };
});

export function verifyTeamWelcome(key: string, keys: TeamKeys, proof: string) {
  return verifyChannelProof(key, proof, listTeamWelcomeParts(keys));
}

export function deriveTeamSessionKey(
  key: string,
  keys: TeamKeys,
  privateKey: CryptoKey,
  peerEphemeral: string
) {
  const parts = [keys.team, serializeTeamView(keys.view), keys.clientEphemeral, keys.serverEphemeral];
  return deriveChannelSessionKey(TEAM_SESSION_LABEL, key, parts, privateKey, peerEphemeral);
}

function listSnapshotBytes(body: string) {
  return encodeText(`${SNAPSHOT_LABEL}\n${body}`);
}

export const signTeamSnapshot = Effect.fn('signTeamSnapshot')(function* (
  privateKey: CryptoKey,
  body: TeamSnapshotBody
) {
  const text = JSON.stringify(body);
  const signature = yield* Effect.promise(() =>
    crypto.subtle.sign(SNAPSHOT_SIGNATURE, privateKey, listSnapshotBytes(text))
  );
  const snapshot: TeamSnapshot = { body: text, signature: serializeBase64Url(new Uint8Array(signature)) };
  return snapshot;
});

export function isTeamSnapshotExpired(updatedAt: number, now: number) {
  return now - updatedAt > TEAM_SNAPSHOT_TTL_MS;
}

export function readTeamSnapshot(value: unknown): Option.Option<TeamSnapshot> {
  if (!isRecord(value)) return Option.none();
  const { body, signature } = value;
  return typeof body === 'string' && typeof signature === 'string'
    ? Option.some({ body, signature })
    : Option.none();
}

function readSnapshotBody(text: string): TeamSnapshotBody | null {
  const fields = Option.getOrUndefined(parseJsonRecord(text));
  if (!fields) return null;
  const { teamId, instanceId, tasks, updatedAt } = fields;
  if (!(typeof teamId === 'string' && typeof instanceId === 'string' && typeof updatedAt === 'number'))
    return null;
  return Array.isArray(tasks) ? { teamId, instanceId, tasks: tasks as TeamTask[], updatedAt } : null;
}

export function selectTeamSnapshotSigner(snapshot: TeamSnapshot) {
  return Option.flatMap(parseJsonRecord(snapshot.body), ({ instanceId }) =>
    typeof instanceId === 'string' ? Option.some(instanceId) : Option.none()
  );
}

export const verifyTeamSnapshot = Effect.fn('verifyTeamSnapshot')(function* (
  signingKey: string,
  snapshot: TeamSnapshot
) {
  const key = yield* parseSigningPublicKey(signingKey);
  const signature = Option.getOrNull(parseBase64Url(snapshot.signature));
  if (!(key && signature)) return null;
  const valid = yield* Effect.promise(() =>
    crypto.subtle.verify(SNAPSHOT_SIGNATURE, key, signature, listSnapshotBytes(snapshot.body))
  );
  return valid ? readSnapshotBody(snapshot.body) : null;
});
