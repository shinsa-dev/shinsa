import type { ProgramId, UpdateOutcome } from '@shinsa/core';
import { Duration, Schema } from 'effect';
import type { Effect } from 'effect';
import type { Argv } from '../shell/schema.ts';

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

export interface SdkVersions {
  version: string;
  claudeCodeVersion: string;
}

export type UpdateRun = (onLine: LineListener) => Effect.Effect<UpdateOutcome, VersionsCallFailed>;

export interface VersionsInput {
  readonly onUpdated: (program: ProgramId) => Effect.Effect<void, VersionsCallFailed>;
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
