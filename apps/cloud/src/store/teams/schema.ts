import { AccessScopes, RemoteUserId, TeamId } from '@shinsa/core';
import { Schema } from 'effect';

export const StoredScopes = Schema.NullOr(Schema.fromJsonString(AccessScopes));

export const Team = Schema.Struct({
  id: TeamId,
  ownerId: RemoteUserId,
  name: Schema.String,
  scopes: StoredScopes,
  createdAt: Schema.Number,
});

export type Team = typeof Team.Type;

export const NewTeam = Team.mapFields(({ scopes: _, ...fields }) => fields);

export type NewTeam = typeof NewTeam.Type;

export const MemberScopesRow = Schema.Struct({
  userId: RemoteUserId,
  scopes: Schema.fromJsonString(AccessScopes),
});

export type MemberScopesRow = typeof MemberScopesRow.Type;

export const TEAM_COLUMNS = 'teams.id, teams.owner_id, teams.name, teams.scopes, teams.created_at';
