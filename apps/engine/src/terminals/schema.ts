import {
  type DomainError,
  isServiceEnvKey,
  isServicePreviewUrl,
  SERVICE_LIMITS,
  SERVICE_PORT_VARIABLE,
  type ServiceDefinition,
  type ServiceSuggestion,
  type ShinsaState,
  type TerminalForeground,
  type TerminalInfo,
  type TerminalPlaceKind,
  type TerminalsSnapshot,
} from '@shinsa/core';
import { Duration, Effect, Schedule, Schema } from 'effect';
import type { TerminalSession, TerminalViewer } from './session.ts';

export class PortUnavailable extends Schema.TaggedError<PortUnavailable, { readonly brand: unique symbol }>()(
  'PortUnavailable',
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

export type TerminalSpawner = (command: string[], options: TerminalSpawnOptions) => TerminalProcess;

export type PortListener = (port: number) => number | null;

type PortPicker = (preferred: number | null, taken: ReadonlySet<number>) => number;

type ForegroundReader = (pid: number) => Promise<string | null>;

export interface TerminalsOptions {
  dataDir: string;
  home: string;
  version: string;
  readOnly?: boolean;
  env?: Env;
  spawn?: TerminalSpawner;
  readForeground?: ForegroundReader;
  pickPort?: PortPicker;
  now?: () => number;
  newId?: () => string;
  notifyMs?: number;
  screenMs?: number;
}

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
  resolveRemoteUrl(info: TerminalInfo, service: ServiceDefinition): string | null;
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

export const NOTIFY_MS = 50;

export const SCREEN_MS = 2_000;

export const DROPPED_KEYS =
  /^(?:TERM_PROGRAM|TERM_PROGRAM_VERSION|TERM_SESSION_ID|GHOSTTY_.*|ITERM_.*|SHINSA_SERVICE|COLUMNS|LINES)$/;

export const LOCALE_KEYS = ['LC_ALL', 'LC_CTYPE', 'LANG'];

const PORT_ATTEMPTS = 20;

export const PORT_RETRY = Schedule.recurs(PORT_ATTEMPTS - 1);

export const NO_FREE_PORT = 'No free port for the service.';

export const HANG_UP_GRACE = Duration.seconds(3);

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

export const SOCKET_CLOSED = 4404;

export type TerminalsListener = (snapshot: TerminalsSnapshot) => void;

export interface TerminalsDefinition {
  dataDir: string;
  home: string;
  version: string;
  readOnly: boolean;
  env: Env;
  spawn?: TerminalSpawner;
  readForeground?: (pid: number) => Effect.Effect<string | null>;
  pickPort?: (preferred: number | null, taken: ReadonlySet<number>) => Effect.Effect<number>;
  now: Effect.Effect<number>;
  newId: Effect.Effect<string>;
  notifyMs: Duration.Duration;
  screenMs: Duration.Duration;
}

export interface TerminalsHandle {
  find: (id: string) => Effect.Effect<TerminalSession, DomainError>;
  select: (id: string) => Effect.Effect<TerminalSession | null>;
  snapshot: Effect.Effect<TerminalsSnapshot>;
  applyRemoteUrls: (source: RemoteUrlSource) => Effect.Effect<void>;
  subscribe: (listener: TerminalsListener) => Effect.Effect<() => void>;
  create: (start: TerminalStart) => Effect.Effect<TerminalInfo, DomainError>;
  rename: (id: string, name: string | null) => Effect.Effect<void, DomainError>;
  reorder: (projectId: string, ids: string[]) => Effect.Effect<void, DomainError>;
  restart: (id: string) => Effect.Effect<TerminalInfo, DomainError>;
  run: (id: string, command: string) => Effect.Effect<void, DomainError>;
  readForeground: (id: string) => Effect.Effect<TerminalForeground, DomainError>;
  close: (id: string) => Effect.Effect<void, DomainError>;
  findService: (id: string) => Effect.Effect<ServiceDefinition, DomainError>;
  addService: (projectId: string, input: ServiceInput) => Effect.Effect<ServiceDefinition, DomainError>;
  updateService: (id: string, input: ServiceInput) => Effect.Effect<ServiceDefinition, DomainError>;
  removeServices: (ids: string[]) => Effect.Effect<void, DomainError>;
  startService: (id: string, run: ServiceRun) => Effect.Effect<TerminalInfo, DomainError>;
  stopService: (id: string, taskId: string | null) => Effect.Effect<void, DomainError>;
  restartService: (id: string, run: ServiceRun) => Effect.Effect<TerminalInfo, DomainError>;
  readServiceOutput: (id: string, taskId: string | null, lines: number) => Effect.Effect<string[]>;
  closeTaskServices: (taskId: string) => Effect.Effect<void>;
  listServiceProcesses: Effect.Effect<{ taskId: string; pid: number }[]>;
  listTerminalPids: Effect.Effect<number[]>;
  resumeServices: (state: ShinsaState) => Effect.Effect<void>;
  attach: (id: string, viewer: TerminalViewer) => Effect.Effect<void, DomainError>;
  stop: Effect.Effect<void>;
}
