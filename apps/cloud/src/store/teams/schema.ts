import { RemoteUserId, TeamId, TeamPermissionsPatch } from '@shinsa/core';
import { Schema } from 'effect';

export const StoredPermissions = Schema.fromJsonString(TeamPermissionsPatch);

export const Team = Schema.Struct({
  id: TeamId,
  userId: RemoteUserId,
  name: Schema.String,
  permissions: StoredPermissions,
  createdAt: Schema.Number,
});

export type Team = typeof Team.Type;

export const NewTeam = Team.mapFields(({ permissions: _, ...fields }) => fields);

export type NewTeam = typeof NewTeam.Type;

export const MemberPermissionsRow = Schema.Struct({
  userId: RemoteUserId,
  permissions: StoredPermissions,
});

export type MemberPermissionsRow = typeof MemberPermissionsRow.Type;

export const TEAM_COLUMNS = 'teams.id, teams.user_id, teams.name, teams.permissions, teams.created_at';
