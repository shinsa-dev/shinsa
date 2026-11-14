import {
  isServiceEnvKey,
  isServicePreviewUrl,
  SERVICE_LIMITS,
  SERVICE_PORT_VARIABLE,
  type ServiceDefinition,
  type ServiceSuggestion,
  TERMINAL_STREAM_CLOSE,
  type TerminalColors,
  type TerminalInfo,
  type TerminalPlaceKind,
  type TerminalsSnapshot,
} from '@shinsa/core';
import { Context, Duration, Effect, Schedule, Schema } from 'effect';

export class PortUnavailable extends Schema.TaggedError<PortUnavailable, { readonly brand: unique symbol }>()(
  'PortUnavailable',
  { message: Schema.String }
) {}

export class SpawnFailed extends Schema.TaggedError<SpawnFailed, { readonly brand: unique symbol }>()(
  'SpawnFailed',
  { message: Schema.String }
) {}

export class PortTaken extends Schema.TaggedError<PortTaken, { readonly brand: unique symbol }>()(
  'PortTaken',
  {
    port: Schema.NullOr(Schema.Number),
  }
) {}

const StoredId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9-]{1,64}$/));

const TextOrNull = Schema.NullOr(Schema.String);

const NumberOrNull = Schema.NullOr(Schema.Number);

const Port = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThan(65536));

const EnvKey = Schema.String.check(Schema.makeFilter(isServiceEnvKey));

export const StoredTerminal = Schema.Struct({
  id: StoredId,
  projectId: Schema.String,
  name: TextOrNull,
  title: TextOrNull,
  cwd: Schema.String,
  place: Schema.Literals(['repository', 'folder', 'worktree']),
  taskId: TextOrNull,
  serviceId: TextOrNull.pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  port: Schema.NullOr(Port).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  status: Schema.Literals(['running', 'exited', 'stopped']),
  exitCode: NumberOrNull,
  startedAt: Schema.Number,
  endedAt: NumberOrNull,
});

export const StoredService = Schema.Struct({
  id: StoredId,
  projectId: Schema.String,
  name: Schema.NonEmptyString,
  cwd: Schema.String,
  command: Schema.String,
  env: Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(SERVICE_LIMITS.envValue))).check(
    Schema.makeFilter(
      (env) => Object.keys(env).length <= SERVICE_LIMITS.envKeys && Object.keys(env).every(isServiceEnvKey)
    )
  ),
  previewUrl: Schema.NullOr(Schema.String.check(Schema.makeFilter(isServicePreviewUrl))).pipe(
    Schema.withDecodingDefault(Effect.succeed(null))
  ),
  portVariable: EnvKey.pipe(Schema.withDecodingDefault(Effect.succeed(SERVICE_PORT_VARIABLE))),
});

const StoredList = Schema.Array(Schema.Unknown);

export const StoredTerminals = Schema.Struct({ terminals: StoredList });

export const StoredServices = Schema.Struct({ services: StoredList });

export const RefinedEntry = Schema.Struct({
  index: Schema.Number.check(Schema.isInt()),
  name: Schema.String,
  command: Schema.String,
  previewUrl: Schema.String,
  portVariable: Schema.String,
  recommended: Schema.Boolean,
});
export type RefinedEntry = typeof RefinedEntry.Type;

export const RefinedAnswer = Schema.Struct({ services: StoredList });

type Env = Record<string, string | undefined>;

export interface TerminalProcess {
  pid: number;
  write: (data: string | Uint8Array) => void;
  resize: (cols: number, rows: number) => void;
  hangUp: () => void;
  exited: Promise<number>;
}

export interface TerminalSpawnOptions {
  cwd: string;
  cols: number;
  rows: number;
  env: Env;
  onData: (data: Uint8Array) => void;
}

type TerminalSpawner = (
  command: readonly string[],
  options: TerminalSpawnOptions
) => Effect.Effect<TerminalProcess, SpawnFailed>;

export type PortListener = (port: number) => number | null;

export interface TerminalViewer {
  send: (data: string | Uint8Array) => number;
  buffered: () => number;
  end: () => void;
}

export interface SessionStart {
  command: string[];
  env: Record<string, string>;
  spawn: TerminalSpawner;
}

export interface SessionOptions {
  info: TerminalInfo;
  saved: string | null;
  now: Effect.Effect<number>;
  onChange: Effect.Effect<void>;
  onScreen: (session: TerminalSession) => Effect.Effect<void>;
}

export interface TerminalSession {
  info: TerminalInfo;
  readonly running: boolean;
  readonly pid: number | null;
  readonly viewers: number;
  readonly lastActiveAt: number;
  start(start: SessionStart): Effect.Effect<void, SpawnFailed>;
  fail(reason: string): Effect.Effect<void>;
  attach(viewer: TerminalViewer): void;
  detach(viewer: TerminalViewer): void;
  drain(viewer: TerminalViewer): void;
  input(data: string | Uint8Array): void;
  type(command: string): void;
  resize(cols: number, rows: number): void;
  clear(): void;
  replaceColors(colors: TerminalColors): void;
  readonly serializeScreen: Effect.Effect<string>;
  readOutput(lines: number): Effect.Effect<string[]>;
  hangUp(): void;
  readonly stop: Effect.Effect<void>;
  dispose(): void;
}

export const TerminalHolder = Schema.Struct({
  taskId: Schema.NullOr(Schema.String),
  service: Schema.NullOr(Schema.String),
});
export type TerminalHolder = typeof TerminalHolder.Type;

export interface TerminalsInput {
  version: string;
  env: Env;
}

export const TerminalTimings = Context.Reference<{
  readonly notify: Duration.Duration;
  readonly screen: Duration.Duration;
  readonly sweep: Duration.Duration;
  readonly answer: Duration.Duration;
  readonly answerLimit: Duration.Duration;
}>('shinsa/engine/terminals/TerminalTimings', {
  defaultValue: () => ({
    notify: Duration.millis(50),
    screen: Duration.seconds(2),
    sweep: Duration.minutes(1),
    answer: Duration.millis(500),
    answerLimit: Duration.minutes(10),
  }),
});

export const TerminalIds = Context.Reference<Effect.Effect<string>>('shinsa/engine/terminals/TerminalIds', {
  defaultValue: () => Effect.sync(() => Bun.randomUUIDv7()),
});

export interface TerminalStart {
  projectId: string;
  cwd: string;
  place: TerminalPlaceKind;
  taskId: string | null;
}

export interface ServiceRun {
  cwd: string;
  place: TerminalPlaceKind;
  taskId: string | null;
  env?: Record<string, string>;
}

export interface ServiceInput {
  name: string;
  cwd: string;
  command: string;
  env: Record<string, string>;
  previewUrl: string | null;
  portVariable: string;
}

export interface RemoteUrlSource {
  resolveRemoteUrl(info: TerminalInfo, service: ServiceDefinition): Effect.Effect<string | null>;
  subscribe(listener: () => void): unknown;
}

export interface RefinedSuggestions {
  suggestions: ServiceSuggestion[];
  refined: boolean;
}

export interface FolderDigest {
  folder: string;
  scripts: Record<string, string>;
  dependencies: string[];
}

export const TERMINALS_DIR = 'terminals';

export const TERMINALS_FILE = 'terminals.json';

export const SERVICES_FILE = 'services.json';

export const SCREEN_MODE = 0o600;

export const DROPPED_KEYS =
  /^(?:TERM_PROGRAM|TERM_PROGRAM_VERSION|TERM_SESSION_ID|GHOSTTY_.*|ITERM_.*|SHINSA_SERVICE|COLUMNS|LINES)$/;

export const LOCALE_KEYS = ['LC_ALL', 'LC_CTYPE', 'LANG'];

const PORT_ATTEMPTS = 20;

export const PORT_RETRY = Schedule.recurs(PORT_ATTEMPTS - 1);

const PORT_RELEASE = Duration.seconds(5);

const PORT_RELEASE_POLL = Duration.millis(100);

export const PORT_RELEASE_SCHEDULE = Schedule.spaced(PORT_RELEASE_POLL).pipe(
  Schedule.upTo({ duration: PORT_RELEASE })
);

export const NO_FREE_PORT = 'No free port for the service.';

export const FOLDER_GONE_MESSAGE = 'That folder is not there anymore.';

export const SPAWN_FAILED_MESSAGE = 'The command could not be started';

export const HANG_UP_GRACE = Duration.seconds(3);

const GROUP_POLL = Duration.millis(50);

export const GROUP_POLL_SCHEDULE = Schedule.spaced(GROUP_POLL);

export const ANSWER_HOSTS = ['127.0.0.1', '::1'];

export const ANSWER_TIMEOUT = Duration.millis(250);

export const FOREGROUND_TIMEOUT = Duration.seconds(5);

export const REFINE_LIMITS = { scripts: 12, script: 200, dependencies: 60 };

export interface ServiceMachine {
  home: string;
  dataDir: string;
}

export interface TerminalSocketData {
  kind: 'terminal';
  terminalId: string;
  viewer: TerminalViewer | null;
}

export const TERMINAL_SOCKET_PATH = /^\/ws\/terminals\/([A-Za-z0-9-]{1,64})$/;

export const SOCKET_CLOSED = TERMINAL_STREAM_CLOSE.gone;

export type TerminalsListener = (snapshot: TerminalsSnapshot) => void;
