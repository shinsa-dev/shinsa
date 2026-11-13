import type {
  ConnectChannel,
  ConnectClaim,
  DomainError,
  ScopedActor,
  PairingView,
  RemoteSnapshot,
  TaskGuest,
  TaskOwner,
} from '@shinsa/core';
import type { NotFound, RateLimited, Revoked } from '@shinsa/core/remote/errors';
import { type Effect, Schema, type Scope } from 'effect';
import type { ChannelHub, ChannelPeer, ChannelTerminals, RemoteChannelHandle } from '../channel/schema.ts';
import type { RemoteUnreachable } from '../client/schema.ts';

export const REMOTE_ACCESS_CHANGED = 'Remote access to this machine changed.';

export const SECRET_BYTES = 32;

export const MAX_REQUESTS = 20;

export const HANDOFF_NOT_ENABLED =
  'Turn on remote access in Settings → General to hand off this task. Its link works once this machine is reachable.';

export const HANDOFF_UNAVAILABLE = 'This machine cannot hand off tasks right now. Try again in a moment.';

export const UNKNOWN_PERSON = { login: 'guest', name: null, avatarUrl: null } as const;

export type TeamScope = Extract<ScopedActor['scope'], { kind: 'team' }>;

export const NOWHERE: ScopedActor['scope'] = { kind: 'task', taskId: '' };

export class RemoteKeyUnreadable extends Schema.TaggedError<
  RemoteKeyUnreadable,
  { readonly brand: unique symbol }
>()('RemoteKeyUnreadable', { message: Schema.String }) {}

export class HandoffClaimFailed extends Schema.TaggedError<
  HandoffClaimFailed,
  { readonly brand: unique symbol }
>()('HandoffClaimFailed', { message: Schema.String }) {}

export class RemoteUrlUnopened extends Schema.TaggedError<
  RemoteUrlUnopened,
  { readonly brand: unique symbol }
>()('RemoteUrlUnopened', { message: Schema.String }) {}

export interface RemoteInput {
  readonly version: string;
  readonly machineName: string;
  readonly maxBodyBytes: number;
  readonly localUrl: Effect.Effect<string>;
}

export interface ChannelParts {
  readonly hub: ChannelHub;
  readonly terminals: ChannelTerminals | null;
  readonly respond: (request: Request, guest: ScopedActor | null, userId: string) => Effect.Effect<Response>;
}

export type GuestLeaver = (userIds: string[]) => Effect.Effect<void>;

export type HandoffClaim = (
  taskId: string,
  guest: TaskGuest
) => Effect.Effect<string | null, HandoffClaimFailed>;

type RemoteCallFailure =
  | DomainError
  | NotFound
  | RateLimited
  | Revoked
  | RemoteUnreachable
  | RemoteKeyUnreadable;

export interface RemoteHandle {
  readonly machineName: string;
  readonly snapshot: Effect.Effect<RemoteSnapshot>;
  readonly isEnabled: Effect.Effect<boolean>;
  readonly startPairing: Effect.Effect<PairingView, RemoteCallFailure>;
  readonly cancelPairing: Effect.Effect<void>;
  resolveHookUrl(scheduleId: string, token: string): Effect.Effect<string | null>;
  readonly enable: Effect.Effect<void, DomainError>;
  readonly disable: Effect.Effect<void, DomainError>;
  readonly remove: Effect.Effect<void, DomainError>;
  readonly createLink: Effect.Effect<void, RemoteCallFailure>;
  readonly removeLink: Effect.Effect<void, RemoteCallFailure>;
  handleClaims(claim: HandoffClaim): Effect.Effect<void>;
  handleLeaves(leave: GuestLeaver): Effect.Effect<void>;
  createHandoff(taskId: string): Effect.Effect<string, RemoteCallFailure>;
  removeHandoff(taskId: string, guestId: string | null): Effect.Effect<void, RemoteCallFailure>;
  grantTeammate(userId: string, teamId: string): Effect.Effect<void, RemoteCallFailure>;
  shareWithTeam(teamId: string): Effect.Effect<void, RemoteCallFailure>;
  syncSharedTeams(teamIds: readonly string[]): Effect.Effect<string[]>;
  unshareTeam(teamId: string): Effect.Effect<void, RemoteCallFailure>;
  acceptRequest(requestId: string): Effect.Effect<void, RemoteCallFailure>;
  declineRequest(requestId: string): Effect.Effect<void, DomainError>;
  removeMember(userId: string): Effect.Effect<void, RemoteCallFailure>;
  readonly publish: Effect.Effect<void>;
  observe(listener: Effect.Effect<void>): Effect.Effect<void, never, Scope.Scope>;
  readonly start: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
  readonly requestHeartbeat: Effect.Effect<void>;
  verifyConnect(token: string | null, channel: ConnectChannel): Effect.Effect<ConnectClaim | null>;
  spendConnect(claim: ConnectClaim): Effect.Effect<boolean>;
  isOwner(userId: string | null): Effect.Effect<boolean>;
  hasAccess(userId: string): Effect.Effect<boolean>;
  resolveActor(userId: string | null): Effect.Effect<TaskOwner | null>;
  resolveTeamScope(userId: string, teamId: string): Effect.Effect<TeamScope | null>;
  listTeamScopes(userId: string): Effect.Effect<TeamScope[]>;
  resolveTeamGrant(userId: string, teamId: string): Effect.Effect<string | null>;
  canForkTeamTask(task: { readonly teamId: string }): Effect.Effect<boolean>;
  openChannel(peer: ChannelPeer, parts: ChannelParts, userId: string): Effect.Effect<RemoteChannelHandle>;
  closeChannel(channel: RemoteChannelHandle): Effect.Effect<void>;
  removeDevice(publicKey: string): Effect.Effect<boolean>;
}
