import { isRecord, parseJsonRecord } from '../domain/records.ts';
import { DAY_MS } from '../domain/time.ts';
import type { TeamTask } from '../share/teams.ts';
import { encodeText, hasBytes, parseBase64Url, serializeBase64Url, URL_SAFE_SEGMENT } from './bytes.ts';
import {
  REMOTE_APP_ORIGIN,
  REMOTE_CONNECT_PARAM,
  REMOTE_PATHS,
  type TeamAction,
  type TeamPermissions,
  type TeamPermissionsPatch,
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

export const TEAM_PERMISSION_NAMES = ['act', 'takeOver', 'share', 'services', 'message'] as const;

export type TeamPermission = (typeof TEAM_PERMISSION_NAMES)[number];

export const DEFAULT_TEAM_PERMISSIONS: TeamPermissions = {
  act: true,
  takeOver: true,
  share: true,
  services: true,
  message: false,
};

export function resolveTeamPermissions(
  team: TeamPermissionsPatch | null | undefined,
  member: TeamPermissionsPatch | null | undefined = null
): TeamPermissions {
  return { ...DEFAULT_TEAM_PERMISSIONS, ...team, ...member };
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

export interface TeamListView {
  tasks: TeamTask[];
  machineKey: string;
  grant?: string;
  updatedAt: number;
  snapshot?: TeamSnapshot;
  held?: TeamSnapshot[];
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
  return hasBytes(key, TEAM_KEY_BYTES);
}

export function serializeTeamJoinFragment(fragment: TeamJoinFragment) {
  return [fragment.teamId, fragment.invite, fragment.key].join('.');
}

export function parseTeamJoinFragment(fragment: string): TeamJoinFragment | null {
  const parts = fragment.replace(/^#/, '').split('.');
  if (parts.length !== 3 || parts.some((part) => !URL_SAFE_SEGMENT.test(part))) return null;
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
  if (![teamId, instanceId, taskId].every((part) => URL_SAFE_SEGMENT.test(part))) return null;
  return { teamId, instanceId, taskId };
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
  const fields = parseJsonRecord(text);
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
    proof: await signChannelProof(key, listTeamWelcomeParts(keys)),
  };
}

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

export async function signTeamSnapshot(privateKey: CryptoKey, body: TeamSnapshotBody): Promise<TeamSnapshot> {
  const text = JSON.stringify(body);
  const signature = await crypto.subtle.sign(SNAPSHOT_SIGNATURE, privateKey, listSnapshotBytes(text));
  return { body: text, signature: serializeBase64Url(new Uint8Array(signature)) };
}

export function isTeamSnapshotExpired(updatedAt: number, now: number) {
  return now - updatedAt > TEAM_SNAPSHOT_TTL_MS;
}

export function readTeamSnapshot(value: unknown): TeamSnapshot | null {
  if (!isRecord(value)) return null;
  const { body, signature } = value;
  return typeof body === 'string' && typeof signature === 'string' ? { body, signature } : null;
}

function readSnapshotBody(text: string): TeamSnapshotBody | null {
  const fields = parseJsonRecord(text);
  if (!fields) return null;
  const { teamId, instanceId, tasks, updatedAt } = fields;
  if (!(typeof teamId === 'string' && typeof instanceId === 'string' && typeof updatedAt === 'number'))
    return null;
  return Array.isArray(tasks) ? { teamId, instanceId, tasks: tasks as TeamTask[], updatedAt } : null;
}

export function selectTeamSnapshotSigner(snapshot: TeamSnapshot) {
  const instanceId = parseJsonRecord(snapshot.body)?.instanceId;
  return typeof instanceId === 'string' ? instanceId : null;
}

export async function verifyTeamSnapshot(signingKey: string, snapshot: TeamSnapshot) {
  const key = await parseSigningPublicKey(signingKey);
  const signature = parseBase64Url(snapshot.signature);
  if (!(key && signature)) return null;
  const valid = await crypto.subtle.verify(
    SNAPSHOT_SIGNATURE,
    key,
    signature,
    listSnapshotBytes(snapshot.body)
  );
  return valid ? readSnapshotBody(snapshot.body) : null;
}
