import { Context, Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity } from 'effect/http-api';
import {
  SLACK_RELAY_PATHS,
  SlackDirectory,
  SlackDirectoryQuery,
  SlackLinks,
  SlackRelayNotified,
  SlackRelayNotify,
  SlackRelayPost,
  SlackRelayPosted,
  SlackRelayReacted,
  SlackRelayReaction,
  SlackRelaySession,
  SlackRelaySessionSet,
} from '../slack/relay.ts';
import {
  ClaimCode,
  ConnectResponse,
  HandoffRemoveRequest,
  HeartbeatRequest,
  HeartbeatResponse,
  InstanceId,
  InviteAcceptRequest,
  InviteAcceptResponse,
  InviteCreateResponse,
  MemberRequest,
  NativeSignInTokenRequest,
  NativeSignInTokenResponse,
  PairApproveResponse,
  PairPollRequest,
  PairPollResponse,
  PairStartRequest,
  PairStartResponse,
  PairView,
  REMOTE_PATHS,
  REMOTE_SESSION_COOKIE,
  RemoteInstance,
  RemoteMember,
  RemoteOk,
  RemoteSession,
  RemoteTeam,
  RemoteUser,
  type RemoteUserId,
  ShareConnectResponse,
  TeamConnectRequest,
  TeamCreateRequest,
  TeamCreateResponse,
  TeamId,
  TeamInviteResponse,
  TeamJoinRequest,
  TeamJoinResponse,
  TeamScopesRequest,
  TeamPreviewResponse,
} from './contract.ts';
import {
  BodyInvalid,
  BodyTooLarge,
  CloudflareFailed,
  ContentTypeInvalid,
  Forbidden,
  GuestsFull,
  HandoffInvalid,
  InstancesFull,
  InviteInvalid,
  MembersFull,
  NoMachine,
  NotFound,
  NotOwner,
  OwnerCannotLeave,
  PairClaimed,
  PairExpired,
  PostNotYours,
  RateLimited,
  Revoked,
  ServiceFull,
  SignedOut,
  SignInFailed,
  SlackBlocksRefused,
  SlackFailed,
  SlackNotInstalled,
  SlackNotLinked,
  TeamsFull,
  ThreadNotForwarded,
  resolveRemoteFailureWire as wire,
} from './errors.ts';

export class CurrentUser extends Context.Service<CurrentUser, RemoteUser & { readonly id: RemoteUserId }>()(
  'shinsa/core/remote/CurrentUser'
) {}

export class CurrentMachine extends Context.Service<
  CurrentMachine,
  { readonly instanceId: InstanceId; readonly ownerId: RemoteUserId }
>()('shinsa/core/remote/CurrentMachine') {}

export class PageSession extends HttpApiMiddleware.Service<
  PageSession,
  { provides: CurrentUser; requires: never }
>()('shinsa/core/remote/PageSession', {
  requiredForClient: true,
  security: {
    bearer: HttpApiSecurity.bearer,
    cookie: HttpApiSecurity.apiKey({ in: 'cookie', key: REMOTE_SESSION_COOKIE }),
  },
  error: [wire(SignedOut), wire(Forbidden)],
}) {}

export const REMOTE_BODY_LIMIT_BYTES = 16 * 1024;

export const SLACK_RELAY_POST_LIMIT_BYTES = 128 * 1024;

export const BodyLimit = Context.Reference<number>('shinsa/core/remote/BodyLimit', {
  defaultValue: () => REMOTE_BODY_LIMIT_BYTES,
});

export class RequestGate extends HttpApiMiddleware.Service<RequestGate>()('shinsa/core/remote/RequestGate', {
  error: [wire(BodyInvalid), wire(BodyTooLarge), wire(ContentTypeInvalid), wire(NotFound)],
}) {}

export class MachineSession extends HttpApiMiddleware.Service<
  MachineSession,
  { provides: CurrentMachine; requires: never }
>()('shinsa/core/remote/MachineSession', {
  requiredForClient: true,
  security: { bearer: HttpApiSecurity.bearer },
  error: wire(Revoked),
}) {}

const InstanceParams = { instanceId: InstanceId };

const TeamParams = { teamId: TeamId };

class SessionGroup extends HttpApiGroup.make('session')
  .add(
    HttpApiEndpoint.get('read', REMOTE_PATHS.session, { success: RemoteSession }),
    HttpApiEndpoint.post('signOut', REMOTE_PATHS.signOut, { success: RemoteOk, error: wire(Forbidden) }),
    HttpApiEndpoint.post('signInToken', REMOTE_PATHS.signInToken, {
      payload: NativeSignInTokenRequest,
      success: NativeSignInTokenResponse,
      error: wire(SignInFailed),
    })
  )
  .middleware(RequestGate) {}

class PairingGroup extends HttpApiGroup.make('pairing')
  .add(
    HttpApiEndpoint.post('start', REMOTE_PATHS.pairStart, {
      payload: PairStartRequest,
      success: PairStartResponse,
      error: wire(RateLimited),
    }),
    HttpApiEndpoint.post('poll', REMOTE_PATHS.pairPoll, {
      payload: PairPollRequest,
      success: PairPollResponse,
    })
  )
  .middleware(RequestGate) {}

class PairsGroup extends HttpApiGroup.make('pairs')
  .add(
    HttpApiEndpoint.get('view', `${REMOTE_PATHS.pairs}/:claimCode`, {
      params: { claimCode: ClaimCode },
      success: PairView,
      error: wire(PairExpired),
    }),
    HttpApiEndpoint.post('approve', `${REMOTE_PATHS.pairs}/:claimCode/approve`, {
      params: { claimCode: ClaimCode },
      success: PairApproveResponse,
      error: [
        wire(PairExpired),
        wire(InstancesFull),
        wire(ServiceFull),
        wire(PairClaimed),
        wire(CloudflareFailed),
      ],
    })
  )
  .middleware(RequestGate)
  .middleware(PageSession) {}

class InstancesGroup extends HttpApiGroup.make('instances')
  .add(
    HttpApiEndpoint.get('list', REMOTE_PATHS.instances, { success: Schema.Array(RemoteInstance) }),
    HttpApiEndpoint.post('connect', `${REMOTE_PATHS.instances}/:instanceId/connect`, {
      params: InstanceParams,
      success: ConnectResponse,
      error: wire(NotFound),
    }),
    HttpApiEndpoint.post('remove', `${REMOTE_PATHS.instances}/:instanceId/remove`, {
      params: InstanceParams,
      success: RemoteOk,
      error: [wire(NotFound), wire(NotOwner), wire(CloudflareFailed)],
    }),
    HttpApiEndpoint.post('leave', `${REMOTE_PATHS.instances}/:instanceId/leave`, {
      params: InstanceParams,
      success: RemoteOk,
      error: [wire(NotFound), wire(OwnerCannotLeave)],
    }),
    HttpApiEndpoint.post('inviteAccept', REMOTE_PATHS.inviteAccept, {
      payload: InviteAcceptRequest,
      success: InviteAcceptResponse,
      error: wire(InviteInvalid),
    }),
    HttpApiEndpoint.post('handoffAccept', REMOTE_PATHS.handoffAccept, {
      payload: InviteAcceptRequest,
      success: InviteAcceptResponse,
      error: wire(HandoffInvalid),
    })
  )
  .middleware(RequestGate)
  .middleware(PageSession) {}

class SharesGroup extends HttpApiGroup.make('shares')
  .add(
    HttpApiEndpoint.post('connect', `${REMOTE_PATHS.shares}/:instanceId/connect`, {
      params: InstanceParams,
      success: ShareConnectResponse,
      error: wire(NotFound),
    })
  )
  .middleware(RequestGate) {}

class TeamsGroup extends HttpApiGroup.make('teams')
  .add(
    HttpApiEndpoint.get('list', REMOTE_PATHS.teams, { success: Schema.Array(RemoteTeam) }),
    HttpApiEndpoint.post('join', REMOTE_PATHS.teamJoin, {
      payload: TeamJoinRequest,
      success: TeamJoinResponse,
      error: [wire(InviteInvalid), wire(NotFound), wire(NoMachine)],
    }),
    HttpApiEndpoint.post('preview', REMOTE_PATHS.teamPreview, {
      payload: TeamJoinRequest,
      success: TeamPreviewResponse,
      error: [wire(InviteInvalid), wire(NotFound)],
    }),
    HttpApiEndpoint.post('leave', `${REMOTE_PATHS.teams}/:teamId/leave`, {
      params: TeamParams,
      success: RemoteOk,
      error: [wire(NotFound), wire(OwnerCannotLeave)],
    }),
    HttpApiEndpoint.post('connect', `${REMOTE_PATHS.teams}/:teamId/connect`, {
      params: TeamParams,
      payload: TeamConnectRequest,
      success: ConnectResponse,
      error: wire(NotFound),
    }),
    HttpApiEndpoint.post('scopes', `${REMOTE_PATHS.teams}/:teamId/scopes`, {
      params: TeamParams,
      payload: TeamScopesRequest,
      success: RemoteTeam,
      error: [wire(NotFound), wire(NotOwner)],
    })
  )
  .middleware(RequestGate)
  .middleware(PageSession) {}

class MachineGroup extends HttpApiGroup.make('machine')
  .add(
    HttpApiEndpoint.post('heartbeat', REMOTE_PATHS.heartbeat, {
      payload: HeartbeatRequest,
      success: HeartbeatResponse,
      error: [wire(NotFound), wire(CloudflareFailed)],
    }),
    HttpApiEndpoint.post('offline', REMOTE_PATHS.offline, { success: RemoteOk }),
    HttpApiEndpoint.post('remove', REMOTE_PATHS.machineRemove, {
      success: RemoteOk,
      error: wire(CloudflareFailed),
    }),
    HttpApiEndpoint.post('inviteCreate', REMOTE_PATHS.machineInvites, { success: InviteCreateResponse }),
    HttpApiEndpoint.post('inviteRemove', REMOTE_PATHS.machineInviteRemove, { success: RemoteOk }),
    HttpApiEndpoint.post('requesterFind', REMOTE_PATHS.machineRequester, {
      payload: MemberRequest,
      success: RemoteUser,
      error: wire(NotFound),
    }),
    HttpApiEndpoint.post('memberAdd', REMOTE_PATHS.machineMemberAdd, {
      payload: MemberRequest,
      success: RemoteMember,
      error: [wire(NotFound), wire(MembersFull)],
    }),
    HttpApiEndpoint.post('memberRemove', REMOTE_PATHS.machineMemberRemove, {
      payload: MemberRequest,
      success: RemoteOk,
    }),
    HttpApiEndpoint.post('handoffCreate', REMOTE_PATHS.machineHandoffs, { success: InviteCreateResponse }),
    HttpApiEndpoint.post('handoffRemove', REMOTE_PATHS.machineHandoffRemove, {
      payload: HandoffRemoveRequest,
      success: RemoteOk,
    }),
    HttpApiEndpoint.post('guestAdd', REMOTE_PATHS.machineGuestAdd, {
      payload: MemberRequest,
      success: RemoteMember,
      error: [wire(NotFound), wire(GuestsFull)],
    }),
    HttpApiEndpoint.post('guestRemove', REMOTE_PATHS.machineGuestRemove, {
      payload: MemberRequest,
      success: RemoteOk,
    })
  )
  .middleware(RequestGate)
  .middleware(MachineSession) {}

const OWNER_FAILURES = [wire(NotFound), wire(NotOwner)];

const machineTeamPath = <const Action extends string>(action: Action) =>
  `${REMOTE_PATHS.machineTeams}/:teamId/${action}` as const;

class MachineTeamsGroup extends HttpApiGroup.make('machineTeams')
  .add(
    HttpApiEndpoint.post('create', REMOTE_PATHS.machineTeams, {
      payload: TeamCreateRequest,
      success: TeamCreateResponse,
      error: wire(TeamsFull),
    }),
    HttpApiEndpoint.post('join', REMOTE_PATHS.machineTeamJoin, {
      payload: TeamJoinRequest,
      success: TeamJoinResponse,
      error: [wire(InviteInvalid), wire(NotFound)],
    }),
    HttpApiEndpoint.post('invite', machineTeamPath('invite'), {
      params: TeamParams,
      success: TeamInviteResponse,
      error: OWNER_FAILURES,
    }),
    HttpApiEndpoint.post('inviteRemove', machineTeamPath('invite/remove'), {
      params: TeamParams,
      success: RemoteOk,
      error: OWNER_FAILURES,
    }),
    HttpApiEndpoint.post('memberAdd', machineTeamPath('members/add'), {
      params: TeamParams,
      payload: MemberRequest,
      success: RemoteMember,
      error: [...OWNER_FAILURES, wire(MembersFull)],
    }),
    HttpApiEndpoint.post('memberRemove', machineTeamPath('members/remove'), {
      params: TeamParams,
      payload: MemberRequest,
      success: RemoteOk,
      error: [...OWNER_FAILURES],
    }),
    HttpApiEndpoint.post('requestDecline', machineTeamPath('requests/decline'), {
      params: TeamParams,
      payload: MemberRequest,
      success: RemoteOk,
      error: [...OWNER_FAILURES],
    }),
    HttpApiEndpoint.post('leave', machineTeamPath('leave'), {
      params: TeamParams,
      success: RemoteOk,
      error: [wire(NotFound), wire(OwnerCannotLeave)],
    }),
    HttpApiEndpoint.post('remove', machineTeamPath('remove'), {
      params: TeamParams,
      success: RemoteOk,
      error: OWNER_FAILURES,
    }),
    HttpApiEndpoint.post('connect', machineTeamPath('connect'), {
      params: TeamParams,
      payload: TeamConnectRequest,
      success: ConnectResponse,
      error: wire(NotFound),
    }),
    HttpApiEndpoint.post('remoteConnect', machineTeamPath('connect/remote'), {
      params: TeamParams,
      payload: TeamConnectRequest,
      success: ConnectResponse,
      error: wire(NotFound),
    }),
    HttpApiEndpoint.post('scopes', machineTeamPath('scopes'), {
      params: TeamParams,
      payload: TeamScopesRequest,
      success: RemoteTeam,
      error: OWNER_FAILURES,
    })
  )
  .middleware(RequestGate)
  .middleware(MachineSession) {}

const THREAD_FAILURES = [wire(ThreadNotForwarded), wire(SlackNotInstalled)];

const WORKSPACE_FAILURES = [wire(SlackNotLinked), wire(SlackNotInstalled)];

class SlackRelayGroup extends HttpApiGroup.make('slackRelay')
  .add(
    HttpApiEndpoint.get('links', SLACK_RELAY_PATHS.links, { success: SlackLinks }),
    HttpApiEndpoint.post('unlink', SLACK_RELAY_PATHS.unlink, { success: RemoteOk }),
    HttpApiEndpoint.post('post', SLACK_RELAY_PATHS.post, {
      payload: SlackRelayPost,
      success: SlackRelayPosted,
      error: [...THREAD_FAILURES, wire(PostNotYours), wire(SlackFailed), wire(SlackBlocksRefused)],
    }).annotate(BodyLimit, SLACK_RELAY_POST_LIMIT_BYTES),
    HttpApiEndpoint.post('session', SLACK_RELAY_PATHS.session, {
      payload: SlackRelaySession,
      success: SlackRelaySessionSet,
      error: [...THREAD_FAILURES, wire(SlackFailed)],
    }),
    HttpApiEndpoint.post('react', SLACK_RELAY_PATHS.react, {
      payload: SlackRelayReaction,
      success: SlackRelayReacted,
      error: [...THREAD_FAILURES],
    }),
    HttpApiEndpoint.get('directory', SLACK_RELAY_PATHS.directory, {
      query: SlackDirectoryQuery,
      success: SlackDirectory,
      error: [...WORKSPACE_FAILURES, wire(SlackFailed)],
    }),
    HttpApiEndpoint.post('notify', SLACK_RELAY_PATHS.notify, {
      payload: SlackRelayNotify,
      success: SlackRelayNotified,
      error: [...WORKSPACE_FAILURES, wire(PostNotYours), wire(SlackFailed), wire(SlackBlocksRefused)],
    }).annotate(BodyLimit, SLACK_RELAY_POST_LIMIT_BYTES)
  )
  .middleware(RequestGate)
  .middleware(MachineSession) {}

export class RemoteApi extends HttpApi.make('remote').add(
  SessionGroup,
  PairingGroup,
  PairsGroup,
  InstancesGroup,
  SharesGroup,
  TeamsGroup,
  MachineGroup,
  MachineTeamsGroup,
  SlackRelayGroup
) {}
