import { RemoteUserId, TeamId } from '@shinsa/core';
import { Schema } from 'effect';

export const Team = Schema.Struct({
  id: TeamId,
  userId: RemoteUserId,
  name: Schema.String,
  createdAt: Schema.Number,
});

export type Team = typeof Team.Type;

export const TEAM_COLUMNS = 'teams.id, teams.user_id, teams.name, teams.created_at';
