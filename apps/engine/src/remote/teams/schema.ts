import type {
  DomainError,
  RemoteTeam,
  ShinsaCommand,
  ShinsaState,
  TeamJoinStatus,
  TeamSnapshot,
  TeamView,
} from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { Engine } from '../../runtime/engine.ts';
import type { TeamCalls, Token } from '../client/schema.ts';
import type { Remote } from '../index.ts';
import type { LiveShare, ShareChannelBroke, ShareChannelHandle } from '../share-channel/schema.ts';
import type { Shares, ShareTranscripts } from '../shares.ts';
import type { RemoteFile, ResolvedKey, StoredTeamKey, TeamGrant } from '../store/schema.ts';
import type { TeamFeeds } from '../team-feeds.ts';

export const TEAM_REFUSALS = {
  team: 'That machine has left this team.',
  key: 'That machine has no key for this team. Its owner can rejoin from the team’s join link.',
  member:
    'That machine does not list you in this team yet. It catches up the next time it reaches Shinsa Cloud.',
  mismatch: 'Your key for this team does not match that machine’s. Open the team’s join link again.',
  task: 'This task is no longer shown to the team.',
} as const;

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
    message: 'Turn on remote access in Settings → General first. Teams reach your teammates through it.',
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
}

export interface TeamsOptions {
  engine: Pick<Engine, 'state' | 'subscribe' | 'dispatch'>;
  remote: Remote;
  shares: Pick<Shares, 'resolveLive'>;
  transcripts: Pick<ShareTranscripts, 'subscribe'>;
  held?: Pick<TeamFeeds, 'listHeld' | 'subscribeHeld'>;
  now?: () => number;
  random?: (bytes: number) => Uint8Array<ArrayBuffer>;
}

export class TeamCommandFailed extends Schema.TaggedError<
  TeamCommandFailed,
  { readonly brand: unique symbol }
>()('TeamCommandFailed', { message: Schema.String }) {}

export class TeamHeartbeatFailed extends Schema.TaggedError<
  TeamHeartbeatFailed,
  { readonly brand: unique symbol }
>()('TeamHeartbeatFailed', { message: Schema.String }) {}

interface TeamsStore {
  readonly file: Effect.Effect<RemoteFile>;
  readonly selectTeam: (teamId: string) => Effect.Effect<RemoteTeam | null>;
  readonly selectTeamKey: (teamId: string) => Effect.Effect<StoredTeamKey | null>;
  readonly selectGrant: (userId: string) => Effect.Effect<TeamGrant | null>;
  readonly recordTeams: (teams: RemoteTeam[]) => Effect.Effect<void>;
  readonly upsertTeamKey: (stored: StoredTeamKey) => Effect.Effect<void>;
  readonly removeTeam: (teamId: string) => Effect.Effect<void>;
  readonly resolveMachineKey: Effect.Effect<ResolvedKey, ShareChannelBroke>;
  readonly resolveSigningKey: Effect.Effect<ResolvedKey, ShareChannelBroke>;
}

export interface TeamsDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly dispatch: (command: ShinsaCommand) => Effect.Effect<void, DomainError | TeamCommandFailed>;
  readonly teams: TeamCalls;
  readonly token: (machineToken: string) => Token;
  readonly store: TeamsStore;
  readonly publish: Effect.Effect<void>;
  readonly requestHeartbeat: Effect.Effect<void, TeamHeartbeatFailed>;
  readonly appOrigin: Effect.Effect<string>;
  readonly isEnabled: Effect.Effect<boolean>;
  readonly machineName: Effect.Effect<string>;
  readonly acquireAccess: (onEnd: Effect.Effect<void>) => Effect.Effect<Effect.Effect<void>>;
  readonly resolveTaskLive: (taskId: string) => Effect.Effect<LiveShare, ShareChannelBroke>;
  readonly listHeld: (teamId: string) => Effect.Effect<TeamSnapshot[]>;
  readonly now: Effect.Effect<number>;
  readonly random: (bytes: number) => Effect.Effect<Uint8Array<ArrayBuffer>>;
}

export type TeamChannel = ShareChannelHandle<TeamSubject>;

export interface TeamJoin {
  status: TeamJoinStatus;
  teamId: string;
}
