import type { DomainError, ProgramId, UpdateOutcome, VersionsSnapshot } from '@shinsa/core';
import { Duration, Schema } from 'effect';
import type { Effect } from 'effect';
import type { ProgramLocation } from '../agents/providers/versions.ts';
import type { Argv, CommandResult } from '../shell/schema.ts';

export const ProgramIdInput = Schema.Literals(['claude', 'codex']);

export const NpmLatest = Schema.Struct({ version: Schema.String });

export const NpmLatestText = Schema.fromJsonString(Schema.Unknown);

export class NpmRegistryFailed extends Schema.TaggedError<
  NpmRegistryFailed,
  { readonly brand: unique symbol }
>()('NpmRegistryFailed', { packageName: Schema.String, message: Schema.String }) {}

export class VersionsCallFailed extends Schema.TaggedError<
  VersionsCallFailed,
  { readonly brand: unique symbol }
>()('VersionsCallFailed', { message: Schema.String }) {}

export interface Updater {
  command: Argv;
  label: string;
  env?: Record<string, string>;
}

export interface UpdaterDeps {
  which?: (command: string) => string | null;
  isExecutable?: (path: string) => boolean;
}

export type LineListener = (line: string) => void;

export type UpdateRunner = (
  updater: Updater,
  onLine: LineListener,
  signal: AbortSignal
) => Promise<CommandResult>;

export type UpdateRun = (onLine: LineListener) => Promise<UpdateOutcome>;

export interface VersionsOptions {
  inspect?: boolean;
  locate?: (program: ProgramId) => ProgramLocation;
  readVersion?: (program: ProgramId, path: string) => Promise<string | null>;
  minimum?: (program: ProgramId) => string;
  sdk?: () => { version: string; claudeCodeVersion: string };
  latest?: (name: string) => Promise<string>;
  updater?: (program: ProgramId, path: string) => Updater;
  run?: UpdateRunner;
  onUpdated?: (program: ProgramId) => Promise<unknown>;
  now?: () => number;
}

type UpdateEffect = (onLine: LineListener) => Effect.Effect<UpdateOutcome, VersionsCallFailed>;

export interface VersionsDefinition {
  readonly inspect: boolean;
  readonly now: Effect.Effect<number>;
  readonly locate: (program: ProgramId) => ProgramLocation;
  readonly readVersion: (
    program: ProgramId,
    path: string
  ) => Effect.Effect<string | null, VersionsCallFailed>;
  readonly minimum: (program: ProgramId) => string;
  readonly sdk: () => { version: string; claudeCodeVersion: string };
  readonly latest: ((name: string) => Effect.Effect<string, NpmRegistryFailed>) | null;
  readonly updater: (program: ProgramId, path: string) => Updater;
  readonly run:
    | ((updater: Updater, onLine: LineListener) => Effect.Effect<CommandResult, VersionsCallFailed>)
    | null;
  readonly onUpdated: (program: ProgramId) => Effect.Effect<void, VersionsCallFailed>;
  readonly cancel: Effect.Effect<void>;
}

export interface VersionsHandle {
  readonly snapshot: Effect.Effect<VersionsSnapshot, VersionsCallFailed>;
  readonly refresh: Effect.Effect<VersionsSnapshot, VersionsCallFailed>;
  readonly startUpdate: (program: unknown) => Effect.Effect<UpdateEffect, DomainError>;
}

export const NPM_REGISTRY_URL = 'https://registry.npmjs.org';

export const REGISTRY_TIMEOUT = Duration.seconds(10);

const LATEST_TTL = Duration.hours(3);

export const LATEST_TTL_MS = Duration.toMillis(LATEST_TTL);

export const UPDATE_TIMEOUT = Duration.minutes(10);

export const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';

export const PROGRAMS: Record<ProgramId, { label: string; package: string; overrideEnv: string }> = {
  claude: { label: 'Claude Code', package: '@anthropic-ai/claude-code', overrideEnv: 'CLAUDE_EXECUTABLE' },
  codex: { label: 'Codex', package: '@openai/codex', overrideEnv: 'CODEX_EXECUTABLE' },
};

export const PROGRAM_IDS: readonly ProgramId[] = ProgramIdInput.literals;

export const CODEX_LATEST = '@openai/codex@latest';

export const UPDATE_ENV = { NO_COLOR: '1', FORCE_COLOR: '0' };
