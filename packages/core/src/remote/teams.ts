import type { TeamTask } from '../share/teams.ts';
import { parseBase64Url } from './bytes.ts';
import {
  REMOTE_APP_ORIGIN,
  REMOTE_CONNECT_PARAM,
  REMOTE_PATHS,
  type RemoteMember,
  type RemoteRole,
  type RemoteUser,
} from './contract.ts';
import { REMOTE_PROTOCOL_VERSION } from './handshake.ts';
import { serializePublicKey } from './keys.ts';
import {
  deriveChannelSessionKey,
  readChannelFields,
  signChannelProof,
  verifyChannelProof,
} from './share-channel.ts';

const HELLO_LABEL = 'shinsa-team-hello-v1';

const WELCOME_LABEL = 'shinsa-team-welcome-v1';

const SESSION_LABEL = 'shinsa-team-v1 server-to-client';

const SEGMENT = /^[A-Za-z0-9_-]+$/;

export const TEAM_KEY_BYTES = 32;

export const TEAM_NAME_LIMIT = 60;

export const MAX_TEAM_MEMBERS = 20;

export const MAX_OWNED_TEAMS = 10;

export const TEAM_CHANNEL_PATH = '/team';

export const TEAM_TASKS_PATH = '/api/teams/tasks';

export const TEAM_VIEW_PATH = '/api/teams/view';

export type TeamAction =
  | 'invite'
  | 'invite/remove'
  | 'members/add'
  | 'members/remove'
  | 'requests/decline'
  | 'leave'
  | 'remove'
  | 'connect';

export interface TeamMachine {
  id: string;
  name: string;
  userId: string;
  online: boolean;
  lastSeenAt: number | null;
}

export interface RemoteTeam {
  id: string;
  name: string;
  owner: RemoteUser;
  role: RemoteRole;
  members: RemoteMember[];
  requests: RemoteMember[];
  machines: TeamMachine[];
  createdAt: number;
}

export interface TeamCreateRequest {
  name: string;
}

export interface TeamCreateResponse {
  team: RemoteTeam;
  invite: string;
}

export interface TeamInviteResponse {
  invite: string;
}

export interface TeamJoinRequest {
  invite: string;
}

export type TeamJoinStatus = 'requested' | 'member';

export interface TeamJoinResponse {
  teamId: string;
  name: string;
  owner: RemoteUser;
  status: TeamJoinStatus;
}

export interface TeamConnectRequest {
  instanceId: string;
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
}

export interface TeamKeys {
  team: string;
  view: TeamView;
  clientEphemeral: string;
  serverEphemeral: string;
}

export interface TeamListView {
  tasks: TeamTask[];
  updatedAt: number;
}

export type TeamFeedStatus = 'connecting' | 'live' | 'offline' | 'refused';

export interface TeamFeedMachine {
  teamId: string;
  instanceId: string;
  name: string;
  userId: string;
  status: TeamFeedStatus;
  reason: string | null;
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

export interface TeamViewTarget {
  teamId: string;
  instanceId: string;
  taskId: string;
}

export function isTeamKey(key: string) {
  return SEGMENT.test(key) && parseBase64Url(key)?.length === TEAM_KEY_BYTES;
}

export function serializeTeamJoinFragment(fragment: TeamJoinFragment) {
  return [fragment.teamId, fragment.invite, fragment.key].join('.');
}

export function parseTeamJoinFragment(fragment: string): TeamJoinFragment | null {
  const parts = fragment.replace(/^#/, '').split('.');
  if (parts.length !== 3 || parts.some((part) => !SEGMENT.test(part))) return null;
  const [teamId, invite, key] = parts as [string, string, string];
  return isTeamKey(key) ? { teamId, invite, key } : null;
}

export function parseTeamJoinUrl(url: string): TeamJoinFragment | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.pathname !== REMOTE_PATHS.teamJoinPage) return null;
    return parseTeamJoinFragment(parsed.hash);
  } catch {
    return null;
  }
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

export function parseTeamViewTarget(url: URL): TeamViewTarget | null {
  const teamId = url.searchParams.get('team');
  const instanceId = url.searchParams.get('machine');
  const taskId = url.searchParams.get('task');
  if (!(teamId && instanceId && taskId)) return null;
  if (![teamId, instanceId, taskId].every((part) => SEGMENT.test(part))) return null;
  return { teamId, instanceId, taskId };
}

function serializeTeamView(view: TeamView) {
  return view.kind === 'list' ? 'list' : `task:${view.taskId}`;
}

function readTeamView(value: unknown): TeamView | null {
  if (value === null || typeof value !== 'object') return null;
  const fields = value as Record<string, unknown>;
  if (fields.kind === 'list') return { kind: 'list' };
  if (fields.kind === 'task' && typeof fields.taskId === 'string' && SEGMENT.test(fields.taskId))
    return { kind: 'task', taskId: fields.taskId };
  return null;
}

function listHelloParts(team: string, view: TeamView, ephemeral: string) {
  return [HELLO_LABEL, team, serializeTeamView(view), ephemeral];
}

function listWelcomeParts(keys: TeamKeys) {
  return [WELCOME_LABEL, keys.team, serializeTeamView(keys.view), keys.clientEphemeral, keys.serverEphemeral];
}

export async function createTeamHello(
  team: string,
  key: string,
  view: TeamView,
  ephemeral: CryptoKey
): Promise<TeamHello> {
  const serialized = await serializePublicKey(ephemeral);
  return {
    type: 'team-hello',
    version: REMOTE_PROTOCOL_VERSION,
    team,
    view,
    ephemeral: serialized,
    proof: await signChannelProof(key, listHelloParts(team, view, serialized)),
  };
}

export function parseTeamHello(text: string): TeamHello | null {
  const fields = readChannelFields(text);
  if (fields?.type !== 'team-hello' || fields.version !== REMOTE_PROTOCOL_VERSION) return null;
  const view = readTeamView(fields.view);
  const { team, ephemeral, proof } = fields;
  if (!(view && typeof team === 'string' && typeof ephemeral === 'string' && typeof proof === 'string'))
    return null;
  return { type: 'team-hello', version: REMOTE_PROTOCOL_VERSION, team, view, ephemeral, proof };
}

export function verifyTeamHello(key: string, hello: TeamHello) {
  return verifyChannelProof(key, hello.proof, listHelloParts(hello.team, hello.view, hello.ephemeral));
}

export async function createTeamWelcome(key: string, keys: TeamKeys) {
  return {
    type: 'welcome' as const,
    ephemeral: keys.serverEphemeral,
    proof: await signChannelProof(key, listWelcomeParts(keys)),
  };
}

export function verifyTeamWelcome(key: string, keys: TeamKeys, proof: string) {
  return verifyChannelProof(key, proof, listWelcomeParts(keys));
}

export function deriveTeamSessionKey(
  key: string,
  keys: TeamKeys,
  privateKey: CryptoKey,
  peerEphemeral: string
) {
  const parts = [keys.team, serializeTeamView(keys.view), keys.clientEphemeral, keys.serverEphemeral];
  return deriveChannelSessionKey(SESSION_LABEL, key, parts, privateKey, peerEphemeral);
}
