import { Option, Schema } from 'effect';
import { AccessScopes } from '../scopes/schema.ts';
import { URL_SAFE_SEGMENT } from './bytes.ts';
import { isSigningPublicKey } from './keys.ts';
import { RELAY_MACHINE_SEGMENT, RELAY_PATH_PREFIX } from './relay/schema.ts';

export const REMOTE_APP_ORIGIN = 'https://app.shinsa.dev';

export const REMOTE_TUNNEL_DOMAIN = 'shinsa.dev';

export const REMOTE_CHANNEL_PATH = '/remote';

export const REMOTE_CONNECT_PARAM = 'token';

export const REMOTE_ENGINE_HOOK_PREFIX = '/api/hooks/';

export const REMOTE_SESSION_COOKIE = '__Host-shinsa_session';

export const REMOTE_PATHS = {
  app: '/',
  pairStart: '/__remote/pair/start',
  pairPoll: '/__remote/pair/poll',
  pairPage: '/pair',
  enrollPage: '/enroll',
  claimPage: '/claim',
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
  shares: '/__remote/shares',
  sharePage: '/share/t',
  machineInvites: '/__remote/machine/invites',
  machineInviteRemove: '/__remote/machine/invites/remove',
  machineRequester: '/__remote/machine/requesters/find',
  machineMemberAdd: '/__remote/machine/members/add',
  machineMemberRemove: '/__remote/machine/members/remove',
  inviteAccept: '/__remote/invites/accept',
  machineHandoffs: '/__remote/machine/handoffs',
  machineHandoffRemove: '/__remote/machine/handoffs/remove',
  machineGuestAdd: '/__remote/machine/guests/add',
  machineGuestRemove: '/__remote/machine/guests/remove',
  handoffAccept: '/__remote/handoffs/accept',
  previewOpen: '/__remote/previews/open',
  teams: '/__remote/teams',
  teamJoin: '/__remote/teams/join',
  teamJoinPage: '/share/team',
  machineTeams: '/__remote/machine/teams',
  machineTeamJoin: '/__remote/machine/teams/join',
  teamPreview: '/__remote/teams/preview',
} as const;

export const MAX_INSTANCE_MEMBERS = 20;

export const MAX_INSTANCE_GUESTS = 20;

export const REMOTE_NATIVE_CLIENT = 'native';

export const REMOTE_NATIVE_REDIRECT_SCHEMES = ['shinsa:', 'shinsa-dev:'] as const;

export const TEAM_NAME_LIMIT = 60;

export const MAX_TEAM_MEMBERS = 20;

export const MAX_OWNED_TEAMS = 10;

export const REMOTE_TEXT_LIMITS = {
  machineName: 80,
  publicKey: 200,
  version: 60,
  claimCode: 20,
  secret: 100,
  localUrl: 200,
  userId: 64,
  nativeCode: 200,
  feature: 40,
} as const;

const REMOTE_FEATURES_LIMIT = 16;

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

const RemoteText = (limit: number) => Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(limit));

export const InstanceId = Schema.String.check(Schema.isPattern(SEGMENT)).pipe(Schema.brand('InstanceId'));

export type InstanceId = typeof InstanceId.Type;

export const TeamId = Schema.String.check(Schema.isPattern(SEGMENT)).pipe(Schema.brand('TeamId'));

export type TeamId = typeof TeamId.Type;

export const RemoteUserId = RemoteText(REMOTE_TEXT_LIMITS.userId).pipe(Schema.brand('RemoteUserId'));

export type RemoteUserId = typeof RemoteUserId.Type;

export const ClaimCode = Schema.String.check(Schema.isPattern(SEGMENT)).pipe(Schema.brand('ClaimCode'));

export type ClaimCode = typeof ClaimCode.Type;

export const RemoteOk = Schema.Struct({ ok: Schema.Literal(true) });

export const MACHINE_FEATURES = [
  'bound-connect-tokens',
  'sealed-pairing',
  'slack-linked-threads',
  'slack-task-owner',
  'slack-channel-triggers',
] as const;

export type MachineFeature = (typeof MACHINE_FEATURES)[number];

export const MachineFeatures = Schema.Array(RemoteText(REMOTE_TEXT_LIMITS.feature)).check(
  Schema.isMaxLength(REMOTE_FEATURES_LIMIT)
);

export function hasMachineFeature(features: readonly string[], feature: MachineFeature) {
  return features.includes(feature);
}

export const PairStartRequest = Schema.Struct({
  name: RemoteText(REMOTE_TEXT_LIMITS.machineName),
  publicKey: RemoteText(REMOTE_TEXT_LIMITS.publicKey),
  version: RemoteText(REMOTE_TEXT_LIMITS.version),
  features: Schema.optionalKey(MachineFeatures),
});

export type PairStartRequest = typeof PairStartRequest.Type;

export const PairStartResponse = Schema.Struct({
  claimCode: Schema.String,
  pollSecret: Schema.String,
  url: Schema.String,
  expiresAt: Schema.Number,
});

export type PairStartResponse = typeof PairStartResponse.Type;

export const PairPollRequest = Schema.Struct({
  claimCode: RemoteText(REMOTE_TEXT_LIMITS.claimCode),
  pollSecret: RemoteText(REMOTE_TEXT_LIMITS.secret),
});

export type PairPollRequest = typeof PairPollRequest.Type;

export const MachineCredentials = Schema.Struct({
  instanceId: Schema.String,
  machineToken: Schema.String,
  connectKey: Schema.String,
});

export type MachineCredentials = typeof MachineCredentials.Type;

const decodeMachineCredentials = Schema.decodeUnknownOption(Schema.fromJsonString(MachineCredentials));

export function parseMachineCredentials(text: string): Option.Option<MachineCredentials> {
  return decodeMachineCredentials(text);
}

export const PairPollResponse = Schema.Union([
  Schema.Struct({ status: Schema.Literal('pending') }),
  Schema.Struct({ status: Schema.Literal('expired') }),
  Schema.Struct({
    status: Schema.Literal('claimed'),
    sealedCredentials: Schema.String,
    owner: Schema.String,
  }),
  Schema.Struct({ status: Schema.Literal('claimed'), credentials: MachineCredentials, owner: Schema.String }),
]);

export type PairPollResponse = typeof PairPollResponse.Type;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function isLoopbackUrl(value: string) {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

export const HeartbeatRequest = Schema.Struct({
  localUrl: RemoteText(REMOTE_TEXT_LIMITS.localUrl).check(
    Schema.makeFilter(
      (value) => isLoopbackUrl(value) || 'The local address must be this machine’s loopback address.'
    )
  ),
  version: Schema.optionalKey(Schema.String),
  features: Schema.optionalKey(MachineFeatures),
  signingKey: Schema.optionalKey(
    Schema.String.check(
      Schema.makeFilter((value) => isSigningPublicKey(value) || 'The signing key must be a P-256 public key.')
    )
  ),
});

export type HeartbeatRequest = typeof HeartbeatRequest.Type;

export const RemoteUser = Schema.Struct({
  id: Schema.String,
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
});

export type RemoteUser = typeof RemoteUser.Type;

export const RemoteMember = Schema.Struct({ user: RemoteUser, addedAt: Schema.Number });

export type RemoteMember = typeof RemoteMember.Type;

export const RemoteAccess = Schema.Struct({ owner: RemoteUser, members: Schema.Array(RemoteMember) });

export type RemoteAccess = typeof RemoteAccess.Type;

export const RemoteRole = Schema.Literals(['owner', 'member', 'guest', 'teammate']);

export type RemoteRole = typeof RemoteRole.Type;

export const TEAM_ACTIONS = [
  'invite',
  'invite/remove',
  'members/add',
  'members/remove',
  'requests/decline',
  'leave',
  'remove',
  'connect',
  'connect/remote',
  'scopes',
] as const;

export type TeamAction = (typeof TEAM_ACTIONS)[number];

export const TeamScopeOverride = Schema.Struct({
  userId: Schema.String,
  scopes: AccessScopes,
});

export type TeamScopeOverride = typeof TeamScopeOverride.Type;

export const TeamMachine = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  userId: Schema.String,
  online: Schema.Boolean,
  lastSeenAt: Schema.NullOr(Schema.Number),
  signingKey: Schema.optionalKey(Schema.String),
});

export type TeamMachine = typeof TeamMachine.Type;

export const RemoteTeam = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  owner: RemoteUser,
  role: RemoteRole,
  members: Schema.Array(RemoteMember),
  requests: Schema.Array(RemoteMember),
  machines: Schema.Array(TeamMachine),
  scopes: AccessScopes,
  overrides: Schema.Array(TeamScopeOverride),
  createdAt: Schema.Number,
});

export type RemoteTeam = typeof RemoteTeam.Type;

export const HeartbeatResponse = Schema.Struct({
  ...RemoteAccess.fields,
  ok: Schema.Literal(true),
  guests: Schema.Array(RemoteMember),
  teams: Schema.Array(RemoteTeam),
});

export type HeartbeatResponse = typeof HeartbeatResponse.Type;

export const RemoteInstance = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  fingerprint: Schema.String,
  online: Schema.Boolean,
  lastSeenAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  owner: RemoteUser,
  role: RemoteRole,
});

export type RemoteInstance = typeof RemoteInstance.Type;

export const RemoteSession = Schema.Struct({ user: Schema.NullOr(RemoteUser) });

export type RemoteSession = typeof RemoteSession.Type;

export const ConnectResponse = Schema.Struct({ url: Schema.String, expiresAt: Schema.Number });

export type ConnectResponse = typeof ConnectResponse.Type;

export const ShareConnectResponse = Schema.Struct({ url: Schema.String, online: Schema.Boolean });

export type ShareConnectResponse = typeof ShareConnectResponse.Type;

export const InviteCreateResponse = Schema.Struct({ token: Schema.String });

export type InviteCreateResponse = typeof InviteCreateResponse.Type;

export const InviteAcceptRequest = Schema.Struct({ token: RemoteText(REMOTE_TEXT_LIMITS.secret) });

export type InviteAcceptRequest = typeof InviteAcceptRequest.Type;

export const InviteAcceptResponse = Schema.Struct({
  instanceId: Schema.String,
  name: Schema.String,
  owner: RemoteUser,
  user: RemoteUser,
  connect: ConnectResponse,
});

export type InviteAcceptResponse = typeof InviteAcceptResponse.Type;

export const MemberRequest = Schema.Struct({ userId: RemoteUserId });

export type MemberRequest = typeof MemberRequest.Type;

export const HandoffRemoveRequest = Schema.Struct({ token: RemoteText(REMOTE_TEXT_LIMITS.secret) });

export type HandoffRemoveRequest = typeof HandoffRemoveRequest.Type;

export const NativeSignInTokenRequest = Schema.Struct({
  code: RemoteText(REMOTE_TEXT_LIMITS.nativeCode),
  codeVerifier: RemoteText(REMOTE_TEXT_LIMITS.nativeCode),
});

export type NativeSignInTokenRequest = typeof NativeSignInTokenRequest.Type;

export const NativeSignInTokenResponse = Schema.Struct({ token: Schema.String, user: RemoteUser });

export type NativeSignInTokenResponse = typeof NativeSignInTokenResponse.Type;

export const PairView = Schema.Struct({
  claimCode: Schema.String,
  name: Schema.String,
  fingerprint: Schema.String,
  expiresAt: Schema.Number,
  claimed: Schema.Boolean,
});

export type PairView = typeof PairView.Type;

export const PairApproveResponse = Schema.Struct({ instanceId: Schema.String, name: Schema.String });

export type PairApproveResponse = typeof PairApproveResponse.Type;

export const TeamCreateRequest = Schema.Struct({
  name: Schema.Trim.check(
    Schema.isNonEmpty({ message: 'Give the team a name.' }),
    Schema.isMaxLength(TEAM_NAME_LIMIT)
  ),
});

export type TeamCreateRequest = typeof TeamCreateRequest.Type;

export const TeamCreateResponse = Schema.Struct({ team: RemoteTeam, invite: Schema.String });

export type TeamCreateResponse = typeof TeamCreateResponse.Type;

export const TeamInviteResponse = Schema.Struct({ invite: Schema.String });

export type TeamInviteResponse = typeof TeamInviteResponse.Type;

export const TeamJoinRequest = Schema.Struct({ invite: RemoteText(REMOTE_TEXT_LIMITS.secret) });

export type TeamJoinRequest = typeof TeamJoinRequest.Type;

export const TeamJoinStatus = Schema.Literals(['requested', 'member']);

export type TeamJoinStatus = typeof TeamJoinStatus.Type;

export const TeamJoinResponse = Schema.Struct({
  teamId: Schema.String,
  name: Schema.String,
  owner: RemoteUser,
  status: TeamJoinStatus,
});

export type TeamJoinResponse = typeof TeamJoinResponse.Type;

export const TeamPreviewResponse = Schema.Struct({ name: Schema.String, owner: RemoteUser });

export type TeamPreviewResponse = typeof TeamPreviewResponse.Type;

export const TeamConnectRequest = Schema.Struct({ instanceId: InstanceId });

export type TeamConnectRequest = typeof TeamConnectRequest.Type;

export const TeamScopesRequest = Schema.Struct({
  userId: Schema.optionalKey(RemoteUserId),
  scopes: Schema.NullOr(AccessScopes),
});

export type TeamScopesRequest = typeof TeamScopesRequest.Type;

export function resolveTunnelHost(instanceId: string) {
  return `t-${instanceId}.${REMOTE_TUNNEL_DOMAIN}`;
}

export function resolveRelayPath(instanceId: string) {
  return `${RELAY_PATH_PREFIX}${encodeURIComponent(instanceId)}`;
}

export function resolveRelayUrl(instanceId: string, origin: string = REMOTE_APP_ORIGIN) {
  return `${origin.replace(/^http/, 'ws')}${resolveRelayPath(instanceId)}`;
}

export function resolveRelayMachineUrl(instanceId: string, origin: string = REMOTE_APP_ORIGIN) {
  return `${resolveRelayUrl(instanceId, origin)}/${RELAY_MACHINE_SEGMENT}`;
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

export function resolveInstanceLeavePath(instanceId: string) {
  return `${resolveInstancePath(instanceId)}/leave`;
}

export function resolveRemoteHookUrl(
  instanceId: string,
  scheduleId: string,
  token: string,
  origin: string = REMOTE_APP_ORIGIN
) {
  return `${origin}${REMOTE_PATHS.hooks}${[instanceId, scheduleId, token].map(encodeURIComponent).join('/')}`;
}

export interface EnrollFragment {
  instanceId: string;
  machineKey: string;
  secret: string;
  invite: string;
}

export function serializeEnrollFragment(fragment: EnrollFragment) {
  return [fragment.instanceId, fragment.machineKey, fragment.secret, fragment.invite].join('.');
}

export function parseEnrollFragment(fragment: string): Option.Option<EnrollFragment> {
  const parts = fragment.replace(/^#/, '').split('.');
  if (parts.length !== 4 || parts.some((part) => !URL_SAFE_SEGMENT.test(part))) return Option.none();
  const [instanceId, machineKey, secret, invite] = parts as [string, string, string, string];
  return Option.some({ instanceId, machineKey, secret, invite });
}

export function resolveEnrollUrl(fragment: EnrollFragment, origin: string = REMOTE_APP_ORIGIN) {
  return `${origin}${REMOTE_PATHS.enrollPage}#${serializeEnrollFragment(fragment)}`;
}

export function resolveClaimUrl(fragment: EnrollFragment, origin: string = REMOTE_APP_ORIGIN) {
  return `${origin}${REMOTE_PATHS.claimPage}#${serializeEnrollFragment(fragment)}`;
}
