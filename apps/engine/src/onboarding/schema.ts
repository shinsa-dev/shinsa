import { Duration, Schema } from 'effect';
import type { CommandResult } from '../shell/index.ts';

export type CommandRunner = (
  command: string[],
  cwd: string,
  options?: { timeoutMs?: number }
) => Promise<CommandResult>;

export type PrerequisiteId = 'git' | 'brew' | 'gh' | 'claude' | 'bun' | 'codex';

export interface Prerequisite {
  id: PrerequisiteId;
  label: string;
  ok: boolean;
  detail: string;
  fix: string | null;
  command: string | null;
  optional?: boolean;
  signIn?: true;
}

export interface PrerequisiteReport {
  ready: boolean;
  checks: Prerequisite[];
}

export interface PrerequisiteNeeds {
  bun: boolean;
}

export const RevisedProject = Schema.Struct({
  name: Schema.String,
  repos: Schema.mutable(Schema.Array(Schema.String)),
});
export type RevisedProject = typeof RevisedProject.Type;

const ProjectTurn = Schema.Struct({ request: Schema.String, reply: Schema.String });

export const ProjectRevision = Schema.Struct({
  projects: Schema.mutable(Schema.Array(RevisedProject)),
  seen: Schema.mutable(Schema.Array(Schema.String)),
  turns: Schema.mutable(Schema.Array(ProjectTurn)),
});
export type ProjectRevision = typeof ProjectRevision.Type;

export const SetupDraft = Schema.Struct({
  version: Schema.Literal(6),
  id: Schema.String,
  index: Schema.Number,
  furthest: Schema.Number,
  saves: Schema.Number,
  revisit: Schema.Boolean,
  problem: Schema.NullOr(Schema.String),
  access: Schema.mutable(Schema.Array(Schema.String)),
  picked: Schema.mutable(Schema.Array(Schema.String)),
  revision: Schema.NullOr(ProjectRevision),
  help: Schema.NullOr(Schema.String),
});
export type SetupDraft = { -readonly [K in keyof typeof SetupDraft.Type]: (typeof SetupDraft.Type)[K] };

const PREREQUISITE_TIMEOUT = Duration.seconds(15);

export const PREREQUISITE_TIMEOUT_MS = Duration.toMillis(PREREQUISITE_TIMEOUT);
