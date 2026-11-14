import type { AccessScopes, DomainError, TeamJoinStatus, TeamView } from '@shinsa/core';
import type { NotFound, NotOwner, OwnerCannotLeave, Revoked, TeamsFull } from '@shinsa/core/remote/errors';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { ChannelPeer } from '../channel/schema.ts';
import type { RemoteUnreachable } from '../client/schema.ts';
import type { ShareChannelHandle } from '../share-channel/schema.ts';

export const TEAM_REMOTE_CHANGED = 'Remote access on the machine that shows these tasks was turned off.';

export const TEAM_DOMAIN_ERRORS = {
  linkOff: {
    code: 'team_link_off',
    message: 'This team link was turned off. Ask the team’s owner for a new one.',
  },
  notOwner: { code: 'not_owner', message: 'Only the team’s owner can do this.' },
  gone: { code: 'team_not_found', message: 'This machine is not in that team.' },
  notPaired: {
    code: 'remote_not_paired',
    message: 'Turn on remote access in Settings → Cloud first. Teams reach your teammates through it.',
  },
  nameInvalid: { code: 'name_invalid', message: 'Give the team a name.' },
  teamsFull: { code: 'teams_full', message: 'You own as many teams as you can. Remove one first.' },
  linkInvalid: {
    code: 'team_link_invalid',
    message: 'That is not a team link. Copy the whole link, with everything after the #.',
  },
  linkMismatch: {
    code: 'team_link_invalid',
    message: 'That team link does not match its team. Ask for a new one.',
  },
  keyMissing: {
    code: 'team_key_missing',
    message: 'This machine does not hold the team’s key. Open the team link on this machine first.',
  },
  requestNotFound: {
    code: 'request_not_found',
    message: 'No one with that account asked to join this team.',
  },
  membersFull: {
    code: 'members_full',
    message: 'This team has as many members as it can. Remove one first.',
  },
  memberNotFound: { code: 'member_not_found', message: 'No one with that account is in this team.' },
  ownerCannotLeave: { code: 'owner_cannot_leave', message: 'You own this team. Remove it instead.' },
} as const;

export interface TeamSubject {
  teamId: string;
  view: TeamView;
  userId: string;
  present?: boolean;
}

interface StoredTeamKeyView {
  teamId: string;
  name: string;
  key: string;
}

export const KEY_WAITS_LIMIT = 16;

export interface KeyWait {
  readonly teamId: string;
  readonly recipient: string;
  readonly privateKey: CryptoKey;
}

export class TeamCommandFailed extends Schema.TaggedError<
  TeamCommandFailed,
  { readonly brand: unique symbol }
>()('TeamCommandFailed', { message: Schema.String }) {}

export type TeamChannel = ShareChannelHandle<TeamSubject>;

export interface TeamJoin {
  status: TeamJoinStatus;
  teamId: string;
}

type TeamFailure =
  | DomainError
  | TeamCommandFailed
  | NotFound
  | NotOwner
  | OwnerCannotLeave
  | Revoked
  | TeamsFull
  | RemoteUnreachable;

export interface TeamsHandle {
  create(name: string): Effect.Effect<string, TeamFailure>;
  join(url: string): Effect.Effect<TeamJoin, TeamFailure>;
  resolveJoinUrl(teamId: string): Effect.Effect<string, TeamFailure>;
  renewInvite(teamId: string): Effect.Effect<void, TeamFailure>;
  turnOffInvite(teamId: string): Effect.Effect<void, TeamFailure>;
  acceptRequest(teamId: string, userId: string): Effect.Effect<void, TeamFailure>;
  declineRequest(teamId: string, userId: string): Effect.Effect<void, TeamFailure>;
  removeMember(teamId: string, userId: string): Effect.Effect<void, TeamFailure>;
  updateScopes(
    teamId: string,
    userId: string | null,
    scopes: AccessScopes | null
  ): Effect.Effect<void, TeamFailure>;
  updateExtra(teamId: string, userId: string, scopes: AccessScopes): Effect.Effect<void, TeamFailure>;
  readonly listKeys: Effect.Effect<StoredTeamKeyView[]>;
  leave(teamId: string): Effect.Effect<void, TeamFailure>;
  remove(teamId: string): Effect.Effect<void, TeamFailure>;
  requestKey(teamId: string): Effect.Effect<void, TeamFailure>;
  readonly acceptsViewer: Effect.Effect<boolean>;
  openChannel(peer: ChannelPeer, userId: string): Effect.Effect<TeamChannel>;
  closeChannel(channel: TeamChannel): Effect.Effect<void>;
}
