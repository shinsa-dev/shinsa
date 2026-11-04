import type { TeamListView } from '@shinsa/core';
import { Predicate, Schema } from 'effect';

export const JOIN_PATH = '/api/remote/teams/join';

export const PROJECTS_PATH = '/api/projects';

export const COMMANDS_PATH = '/api/commands';

export const PROJECTS_TIMEOUT = '4 seconds';

export const JoinedTeam = Schema.Struct({ teamId: Schema.String });

export const TEAM_LINK_MISMATCH =
  'This team link does not match its team. Ask the team’s owner for a new one.';

export class TeamLinkMismatch extends Schema.TaggedError<
  TeamLinkMismatch,
  { readonly brand: unique symbol }
>()('TeamLinkMismatch', { message: Schema.String }) {}

export const StoredTeamKey = Schema.Struct({
  teamId: Schema.String,
  name: Schema.String,
  key: Schema.String,
  joinedAt: Schema.Number,
});

export type StoredTeamKey = typeof StoredTeamKey.Type;

export const TeamGrantView = Schema.fromJsonString(
  Schema.Struct({
    machineKey: Schema.optional(Schema.NullOr(Schema.String)),
    grant: Schema.optional(Schema.NullOr(Schema.String)),
  })
);

export interface TeamMachineGrant {
  machineKey: string;
  grant: string;
}

export const TeamListViewText = Schema.fromJsonString(
  Schema.Unknown.pipe(Schema.refine((value): value is TeamListView => Predicate.isObject(value)))
);
