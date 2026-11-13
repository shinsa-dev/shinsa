import {
  type ConnectResponse,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type InstanceId,
  type InviteCreateResponse,
  type PairPollRequest,
  type PairPollResponse,
  type PairStartRequest,
  type PairStartResponse,
  REMOTE_APP_ORIGIN,
  type RemoteMember,
  type RemoteUser,
  type RemoteUserId,
  type SlackChannels,
  type SlackChannelWatches,
  type SlackLinks,
  type SlackRelayPost,
  type SlackRelayPosted,
  type SlackRelayReacted,
  type SlackRelayReaction,
  type SlackRelaySession,
  type SlackRelaySessionSet,
  type TeamCreateResponse,
  type TeamId,
  type TeamInviteResponse,
  type TeamJoinResponse,
  type TeamScopesRequest,
  type RemoteTeam,
} from '@shinsa/core';
import type {
  BodyInvalid,
  BodyTooLarge,
  ContentTypeInvalid,
  GuestsFull,
  InviteInvalid,
  MembersFull,
  NotFound,
  NotOwner,
  OwnerCannotLeave,
  PostNotYours,
  RateLimited,
  Revoked,
  SlackBlocksRefused,
  SlackFailed,
  SlackNotInstalled,
  TeamsFull,
  ThreadNotForwarded,
} from '@shinsa/core/remote/errors';
import { Context, type Effect, type Redacted, Schema } from 'effect';
import type { HttpClientError } from 'effect/http';

export const RELAY_FAILED_CODE = 'relay_failed';

export class RemoteUnreachable extends Schema.TaggedError<
  RemoteUnreachable,
  { readonly brand: unique symbol }
>()('RemoteUnreachable', {
  endpoint: Schema.String,
  status: Schema.NullOr(Schema.Int),
  retryable: Schema.Boolean,
  message: Schema.String,
}) {}

export const TRANSPORT_TAGS: ReadonlySet<string> = new Set([
  'HttpClientError',
  'SchemaError',
  'BodyInvalid',
  'BodyTooLarge',
  'ContentTypeInvalid',
]);

export type TransportFailure =
  | HttpClientError.HttpClientError
  | Schema.SchemaError
  | BodyInvalid
  | BodyTooLarge
  | ContentTypeInvalid;

export const REMOTE_CALL_TIMEOUT = '15 seconds';

export const OFFLINE_CALL_TIMEOUT = '2 seconds';

export const RemoteOrigin = Context.Reference<string>('shinsa/engine/remote/client/RemoteOrigin', {
  defaultValue: () => REMOTE_APP_ORIGIN,
});

export class MachineToken extends Context.Service<MachineToken, Redacted.Redacted<string>>()(
  'shinsa/engine/remote/client/MachineToken'
) {}

type RemoteCall<A, E = never> = Effect.Effect<A, E | NotFound | RemoteUnreachable>;

type MachineCall<A, E = never> = RemoteCall<A, E | Revoked>;

export type Token = Redacted.Redacted<string>;

type ThreadFailure = ThreadNotForwarded | SlackNotInstalled;

export interface PairingCalls {
  start(request: PairStartRequest): RemoteCall<PairStartResponse, RateLimited>;
  poll(request: PairPollRequest): RemoteCall<PairPollResponse>;
}

export interface MachineCalls {
  heartbeat(token: Token, request: HeartbeatRequest): MachineCall<HeartbeatResponse, NotFound>;
  offline(token: Token): MachineCall<void>;
  remove(token: Token): MachineCall<void>;
  createInvite(token: Token): MachineCall<InviteCreateResponse>;
  removeInvite(token: Token): MachineCall<void>;
  findRequester(token: Token, userId: RemoteUserId): MachineCall<RemoteUser, NotFound>;
  addMember(token: Token, userId: RemoteUserId): MachineCall<RemoteMember, NotFound | MembersFull>;
  removeMember(token: Token, userId: RemoteUserId): MachineCall<void>;
  createHandoff(token: Token): MachineCall<InviteCreateResponse>;
  removeHandoff(token: Token, invite: string): MachineCall<void>;
  addGuest(token: Token, userId: RemoteUserId): MachineCall<RemoteMember, NotFound | GuestsFull>;
  removeGuest(token: Token, userId: RemoteUserId): MachineCall<void>;
}

type OwnerFailure = NotFound | NotOwner;

export interface TeamCalls {
  create(token: Token, name: string): MachineCall<TeamCreateResponse, TeamsFull>;
  join(token: Token, invite: string): MachineCall<TeamJoinResponse, InviteInvalid | NotFound>;
  invite(token: Token, teamId: TeamId): MachineCall<TeamInviteResponse, OwnerFailure>;
  removeInvite(token: Token, teamId: TeamId): MachineCall<void, OwnerFailure>;
  addMember(
    token: Token,
    teamId: TeamId,
    userId: RemoteUserId
  ): MachineCall<RemoteMember, OwnerFailure | MembersFull>;
  removeMember(token: Token, teamId: TeamId, userId: RemoteUserId): MachineCall<void, OwnerFailure>;
  declineRequest(token: Token, teamId: TeamId, userId: RemoteUserId): MachineCall<void, OwnerFailure>;
  leave(token: Token, teamId: TeamId): MachineCall<void, NotFound | OwnerCannotLeave>;
  remove(token: Token, teamId: TeamId): MachineCall<void, OwnerFailure>;
  connect(token: Token, teamId: TeamId, instanceId: InstanceId): MachineCall<ConnectResponse, NotFound>;
  remoteConnect(token: Token, teamId: TeamId, instanceId: InstanceId): MachineCall<ConnectResponse, NotFound>;
  scopes(token: Token, teamId: TeamId, request: TeamScopesRequest): MachineCall<RemoteTeam, OwnerFailure>;
}

export interface SlackRelayCalls {
  links(token: Token): MachineCall<SlackLinks>;
  unlink(token: Token): MachineCall<void>;
  post(
    token: Token,
    post: SlackRelayPost
  ): MachineCall<SlackRelayPosted, ThreadFailure | PostNotYours | SlackFailed | SlackBlocksRefused>;
  session(
    token: Token,
    session: SlackRelaySession
  ): MachineCall<SlackRelaySessionSet, ThreadFailure | SlackFailed>;
  react(token: Token, reaction: SlackRelayReaction): MachineCall<SlackRelayReacted, ThreadFailure>;
  channels(token: Token): MachineCall<SlackChannels, SlackFailed>;
  watches(token: Token, watches: SlackChannelWatches): MachineCall<void, SlackFailed>;
}
