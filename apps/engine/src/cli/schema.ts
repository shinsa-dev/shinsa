import type { DomainError } from '@shinsa/core';
import { Duration, type Effect, type FileSystem, Schedule, Schema } from 'effect';
import type { MachineConfigFile } from '../config/machine/service.ts';
import type { Remote } from '../git/remote/service.ts';
import type {
  EngineService,
  ServerRunningError,
  ServiceCommandFailed,
  ShinsaBundle,
} from '../instance/index.ts';
import type { Shell } from '../shell/service.ts';
import type { SurfaceFailure } from '../surface/schema.ts';
import type { Display, Progress, Terminal } from '../terminal/index.ts';
import type { ApiClient } from './api.ts';
import type { EngineWake } from './client/index.ts';

export class CliFailed extends Schema.TaggedError<CliFailed, { readonly brand: unique symbol }>()(
  'CliFailed',
  {
    message: Schema.String,
  }
) {}

export class FlagValueMissing extends Schema.TaggedError<
  FlagValueMissing,
  { readonly brand: unique symbol }
>()('FlagValueMissing', { flag: Schema.String, message: Schema.String }) {}

export type CliServices = Shell | Remote | MachineConfigFile | FileSystem.FileSystem;

export const PLUTIL = '/usr/bin/plutil';

export const PLUTIL_TIMEOUT_MS = 10_000;

export type CliFailure = SurfaceFailure | CliFailed | ServiceCommandFailed | ServerRunningError;

export interface EngineControl {
  bundled: boolean;
  service: EngineService;
  waitMs?: number;
}

export interface EngineIo extends EngineControl {
  base: string;
  display: Display;
  write: (line?: string) => void;
  startProgress: (text: string) => Progress;
}

export interface CommandVersion {
  version: string;
  commit: string | null;
}

export interface CommandIo {
  api: ApiClient;
  display: Display;
  home: string | undefined;
  cwd: string;
  write: (line?: string) => void;
  openApp: (link: string) => Effect.Effect<void, CliFailed, CliServices>;
  readRepoRoot: (dir: string) => Effect.Effect<string | null, never, CliServices>;
}

export interface CliIo {
  env: Record<string, string | undefined>;
  cwd: string;
  write: (line?: string) => void;
  writeError: (line: string) => void;
  openApp: (link: string) => Effect.Effect<void, CliFailed, CliServices>;
  readRepoRoot: (dir: string) => Effect.Effect<string | null, never, CliServices>;
  wakeEngine: EngineWake;
  engine: EngineControl;
  runEngine: (
    env: Record<string, string | undefined>
  ) => Effect.Effect<void, DomainError | ServerRunningError | CliFailed, CliServices>;
  terminal: Terminal;
}

export interface OpenAppOptions {
  write: (line: string) => void;
  inApp?: boolean;
  platform?: string;
  env?: Record<string, string | undefined>;
}

export interface WakeOptions {
  bundled: boolean;
  kick: Effect.Effect<boolean, never, Shell>;
  waitMs?: number;
}

export interface ProcessOptions {
  isTerminal?: () => boolean;
  bundle?: ShinsaBundle | null;
  exit?: (code: number) => void;
}

export const HUMAN_ONLY_ENGINE_COMMANDS = ['stop', 'restart', 'engine'] as const;

export const ENGINE_STOPPED =
  'The engine is not running. `shinsa start` starts it, and so does opening the Shinsa app.';

export const HEALTH_TIMEOUT_MS = 1000;

export const ENGINE_WAIT_MS = 20_000;

export const ENGINE_POLL_SCHEDULE = Schedule.spaced(Duration.millis(250));

export const ENGINE_LOG_MAX_BYTES = 8 * 1024 * 1024;
