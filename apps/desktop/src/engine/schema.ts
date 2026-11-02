import { APP_IDENTITY, resolveEngineLabel } from '@shinsa/core';
import { Duration, Schedule, Schema } from 'effect';
import { ServerHealth } from '../server/schema.ts';

export const APP_ID = process.env.SHINSA_APP_ID || APP_IDENTITY.appId;

export const ENGINE_LABEL = resolveEngineLabel(APP_ID);

export const ENGINE_PLIST = `${ENGINE_LABEL}.plist`;

export const ENGINE_BUNDLE_PROGRAM = 'Contents/Resources/engine/bin/shinsa';

export const ENGINE_LOG = 'engine.log';

export const ENGINE_LOCK = 'serve.lock';

export const LOGIN_ITEMS_URL = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension';

export const PRIVACY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

export const RESTART_THROTTLE_SECONDS = 5;

export const CRASHES_BEFORE_GIVING_UP = 3;

export const LOG_TAIL_LINES = 12;

export const EX_CONFIG = 78;

export const ENGINE_VARIABLES = ['SHINSA_HOME', 'SHINSA_DATA_DIR'] as const;

export const Registration = Schema.Literals([
  'enabled',
  'requires-approval',
  'not-registered',
  'not-found',
  'unsupported',
]);

export type Registration = typeof Registration.Type;

export const EngineAction = Schema.Literals([
  'open-login-items',
  'restart',
  'copy-details',
  'retry',
  'open-privacy',
]);

export type EngineAction = typeof EngineAction.Type;

export const ENGINE_ACTION_LABEL: Record<EngineAction, string> = {
  'open-login-items': 'Open Login Items',
  restart: 'Start engine',
  'copy-details': 'Copy details',
  retry: 'Try again',
  'open-privacy': 'Open Privacy & Security',
};

export const ENGINE_ACTION_LINK = /^shinsa:\/\/engine\/([a-z-]+)$/;

export const EngineScreen = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('starting') }),
  Schema.Struct({ kind: Schema.Literal('dev') }),
  Schema.Struct({ kind: Schema.Literal('approval') }),
  Schema.Struct({ kind: Schema.Literal('crashing'), detail: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('port'), port: Schema.Number, detail: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('stopped'), detail: Schema.String }),
]);

export type EngineScreen = typeof EngineScreen.Type;

export interface EngineScreenView {
  title: string;
  text: string;
  actions: EngineAction[];
  detail: string;
  busy: boolean;
}

export const LaunchdJob = Schema.Struct({
  pid: Schema.NullOr(Schema.Int),
  runs: Schema.Int,
  lastExitCode: Schema.NullOr(Schema.Int),
  spawnFailed: Schema.Boolean,
});

export type LaunchdJob = typeof LaunchdJob.Type;

export const LAUNCHD_FIELDS = {
  pid: /^\s*pid = (\d+)/m,
  runs: /^\s*runs = (\d+)/m,
  lastExitCode: /^\s*last exit code = (-?\d+)/m,
  spawnFailed: /^\s*job state = spawn failed/m,
} as const;

export const AGENT_PROGRAM = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/;

export const LockHolder = Schema.fromJsonString(Schema.Struct({ pid: Schema.Number, port: Schema.Number }));

export const EngineLogEntry = Schema.fromJsonString(
  Schema.Struct({
    level: Schema.optionalKey(Schema.Unknown),
    message: Schema.optionalKey(Schema.Unknown),
    error: Schema.optionalKey(Schema.Unknown),
  })
);

export const BUSY_PORT = /Is port (\d+) in use\?/;

export const KICK_AFTER = Duration.seconds(3);

const ENGINE_POLL = Duration.millis(400);

const START_WAIT = Duration.seconds(25);

const LOAD_WAIT = Duration.seconds(3);

export class EngineNotStarted extends Schema.TaggedError<
  EngineNotStarted,
  { readonly brand: unique symbol }
>()('EngineNotStarted', { retryable: Schema.Boolean }) {}

export class EngineJobMissing extends Schema.TaggedError<
  EngineJobMissing,
  { readonly brand: unique symbol }
>()('EngineJobMissing', { target: Schema.String }) {}

export const START_SCHEDULE = Schedule.max([Schedule.spaced(ENGINE_POLL), Schedule.during(START_WAIT)]).pipe(
  Schedule.setInputType<EngineNotStarted>(),
  Schedule.while(({ input }) => input.retryable)
);

export const LOAD_SCHEDULE = Schedule.max([Schedule.spaced(ENGINE_POLL), Schedule.during(LOAD_WAIT)]);

export const EngineOutcome = Schema.Union([
  Schema.TaggedStruct('Running', { health: ServerHealth }),
  Schema.TaggedStruct('Waiting', { screen: EngineScreen }),
]);

export type EngineOutcome = typeof EngineOutcome.Type;
