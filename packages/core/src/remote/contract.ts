export const REMOTE_APP_ORIGIN = 'https://app.shinsa.dev';

export const REMOTE_TUNNEL_DOMAIN = 'shinsa.dev';

export const REMOTE_CHANNEL_PATH = '/remote';

export const REMOTE_CONNECT_PARAM = 'token';

export const REMOTE_ENGINE_HOOK_PREFIX = '/api/hooks/';

export const REMOTE_PATHS = {
  app: '/',
  pairStart: '/__remote/pair/start',
  pairPoll: '/__remote/pair/poll',
  pairPage: '/pair',
  enrollPage: '/enroll',
  heartbeat: '/__remote/machine/heartbeat',
  offline: '/__remote/machine/offline',
  machineRemove: '/__remote/machine/remove',
  session: '/__remote/session',
  signIn: '/__remote/sign-in',
  signInCallback: '/__remote/sign-in/callback',
  signOut: '/__remote/sign-out',
  instances: '/__remote/instances',
  pairs: '/__remote/pairs',
  hooks: '/hooks/',
  signInToken: '/__remote/sign-in/token',
} as const;

export const REMOTE_NATIVE_CLIENT = 'native';

export const REMOTE_NATIVE_REDIRECT_SCHEMES = ['shinsa:', 'shinsa-dev:'] as const;

export interface PairStartRequest {
  name: string;
  publicKey: string;
  version: string;
}

export interface PairStartResponse {
  claimCode: string;
  pollSecret: string;
  url: string;
  expiresAt: number;
}

export interface PairPollRequest {
  claimCode: string;
  pollSecret: string;
}

export interface MachineCredentials {
  instanceId: string;
  machineToken: string;
  tunnelToken: string;
  tunnelHost: string;
  connectKey: string;
}

export type PairPollResponse =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'claimed'; credentials: MachineCredentials; owner: string };

export interface HeartbeatRequest {
  localUrl: string;
  version: string;
}

export interface HeartbeatResponse {
  ok: true;
}

export interface RemoteInstance {
  id: string;
  name: string;
  fingerprint: string;
  online: boolean;
  lastSeenAt: number | null;
  createdAt: number;
}

export interface RemoteSession {
  user: { id: string; login: string; name: string | null; avatarUrl: string | null } | null;
}

export type RemoteUser = NonNullable<RemoteSession['user']>;

export interface NativeSignInTokenRequest {
  code: string;
  codeVerifier: string;
}

export interface NativeSignInTokenResponse {
  token: string;
  user: RemoteUser;
}

export interface PairView {
  claimCode: string;
  name: string;
  fingerprint: string;
  expiresAt: number;
  claimed: boolean;
}

export interface PairApproveResponse {
  instanceId: string;
  name: string;
}

export interface ConnectResponse {
  url: string;
  expiresAt: number;
}

export function resolveTunnelHost(instanceId: string) {
  return `t-${instanceId}.${REMOTE_TUNNEL_DOMAIN}`;
}

export function resolveInstanceConnectPath(instanceId: string) {
  return `${REMOTE_PATHS.instances}/${encodeURIComponent(instanceId)}/connect`;
}

export function resolveInstancePath(instanceId: string) {
  return `${REMOTE_PATHS.instances}/${encodeURIComponent(instanceId)}`;
}

export function resolvePairPath(claimCode: string) {
  return `${REMOTE_PATHS.pairs}/${encodeURIComponent(claimCode)}`;
}

export function resolvePairApprovePath(claimCode: string) {
  return `${resolvePairPath(claimCode)}/approve`;
}

export function resolveInstanceRemovePath(instanceId: string) {
  return `${resolveInstancePath(instanceId)}/remove`;
}

export function resolveRemoteHookUrl(
  instanceId: string,
  scheduleId: string,
  token: string,
  origin: string = REMOTE_APP_ORIGIN
) {
  return `${origin}${REMOTE_PATHS.hooks}${[instanceId, scheduleId, token].map(encodeURIComponent).join('/')}`;
}

export function parseRemoteHookPath(pathname: string) {
  if (!pathname.startsWith(REMOTE_PATHS.hooks)) return null;
  const parts = pathname.slice(REMOTE_PATHS.hooks.length).split('/');
  if (parts.length !== 3 || parts.some((part) => part === '')) return null;
  const [instanceId, scheduleId, token] = parts as [string, string, string];
  return { instanceId, enginePath: `${REMOTE_ENGINE_HOOK_PREFIX}${scheduleId}/${token}` };
}

export function serializeEnrollFragment(instanceId: string, machineKey: string, secret: string) {
  return [instanceId, machineKey, secret].join('.');
}

export function parseEnrollFragment(fragment: string) {
  const parts = fragment.replace(/^#/, '').split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  const [instanceId, machineKey, secret] = parts as [string, string, string];
  return { instanceId, machineKey, secret };
}

export function resolveEnrollUrl(
  instanceId: string,
  machineKey: string,
  secret: string,
  origin: string = REMOTE_APP_ORIGIN
) {
  return `${origin}${REMOTE_PATHS.enrollPage}#${serializeEnrollFragment(instanceId, machineKey, secret)}`;
}
