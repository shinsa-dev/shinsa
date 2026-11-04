import type { TeamSnapshot, TeamTask } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';

export const TEAM_SNAPSHOTS_FILE = 'team-snapshots.json';

export interface HeldTeamList {
  teamId: string;
  instanceId: string;
  keyDigest: string;
  tasks: TeamTask[];
  updatedAt: number;
  snapshot: TeamSnapshot | null;
}

export class TeamSnapshotsKeepFailed extends Schema.TaggedError<
  TeamSnapshotsKeepFailed,
  { readonly brand: unique symbol }
>()('TeamSnapshotsKeepFailed', { message: Schema.String }) {}

export interface TeamSnapshotsDefinition {
  readonly path: string;
}

export interface TeamSnapshotsHandle {
  readonly list: Effect.Effect<HeldTeamList[]>;
  select(teamId: string, instanceId: string): Effect.Effect<HeldTeamList | null>;
  write(held: HeldTeamList): Effect.Effect<void>;
  remove(teamId: string, instanceId: string): Effect.Effect<void>;
}
