import type { ProgramId, UpdateOutcome } from '@shinsa/core';
import { Duration, Schema } from 'effect';
import type { ProgramLocation } from '../agents/providers/versions.ts';
import type { CommandResult } from '../shell/schema.ts';

export const ProgramIdInput = Schema.Literals(['claude', 'codex']);

export const NpmLatest = Schema.Struct({ version: Schema.String });

export const NpmLatestText = Schema.fromJsonString(Schema.Unknown);

export class NpmRegistryFailed extends Schema.TaggedError<
  NpmRegistryFailed,
  { readonly brand: unique symbol }
>()('NpmRegistryFailed', { packageName: Schema.String, message: Schema.String }) {}

export interface Updater {
  command: string[];
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

export const NPM_REGISTRY_URL = 'https://registry.npmjs.org';

export const REGISTRY_TIMEOUT = Duration.seconds(10);

const LATEST_TTL = Duration.hours(3);

export const LATEST_TTL_MS = Duration.toMillis(LATEST_TTL);

const UPDATE_TIMEOUT = Duration.minutes(10);

export const UPDATE_TIMEOUT_MS = Duration.toMillis(UPDATE_TIMEOUT);

export const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';

export const PROGRAMS: Record<ProgramId, { label: string; package: string; overrideEnv: string }> = {
  claude: { label: 'Claude Code', package: '@anthropic-ai/claude-code', overrideEnv: 'CLAUDE_EXECUTABLE' },
  codex: { label: 'Codex', package: '@openai/codex', overrideEnv: 'CODEX_EXECUTABLE' },
};

export const PROGRAM_IDS: readonly ProgramId[] = ProgramIdInput.literals;

export const CODEX_LATEST = '@openai/codex@latest';

export const UPDATE_ENV = { NO_COLOR: '1', FORCE_COLOR: '0' };
