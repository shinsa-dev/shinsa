import type { ShareMessage } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';

export const TEAM_VIEWS_DIR = 'team-views';

export const TEAM_VIEW_FILES_LIMIT = 8 * 1024 * 1024;

export const TEAM_VIEWS_LIMIT = 64 * 1024 * 1024;

export const INDEX_FILE = 'index.json';

export const LiveViewText = Schema.fromJsonString(
  Schema.Struct({
    shared: Schema.Struct({ task: Schema.Struct({ updatedAt: Schema.Number }) }),
    files: Schema.Record(Schema.String, Schema.Unknown),
  })
);

export interface TeamViewEntry {
  teamId: string;
  instanceId: string;
  taskId: string;
  keyDigest: string;
  updatedAt: number;
  size: number;
}

export interface HeldTeamView extends Omit<TeamViewEntry, 'size'> {
  messages: ShareMessage[];
}

export interface StoredViewFile {
  version: string;
  messages: ShareMessage[];
  size: number;
}

export interface ReceivingViewFile extends StoredViewFile {
  dropped: boolean;
}

export class TeamViewKeepFailed extends Schema.TaggedError<
  TeamViewKeepFailed,
  { readonly brand: unique symbol }
>()('TeamViewKeepFailed', { message: Schema.String }) {}

export interface TeamViewsDefinition {
  readonly dir: string;
  readonly limit: number;
}

export interface TeamViewsHandle {
  readonly list: Effect.Effect<TeamViewEntry[]>;
  selectEntry(teamId: string, instanceId: string, taskId: string): Effect.Effect<TeamViewEntry | null>;
  select(teamId: string, instanceId: string, taskId: string): Effect.Effect<HeldTeamView | null>;
  write(view: HeldTeamView): Effect.Effect<void>;
  removeWhere(matches: (entry: TeamViewEntry) => boolean): Effect.Effect<void>;
}
