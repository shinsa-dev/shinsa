import { Duration, type Effect, Schedule, Schema } from 'effect';
import { LogLevel } from '../update-log/schema.ts';

export const UPDATE_FEED = {
  provider: 'generic',
  url: 'https://shinsa.dev/updates',
  useMultipleRangeRequest: false,
} as const;

export const UpdateChannel = Schema.Literals(['stable', 'beta', 'canary']);

export type UpdateChannel = typeof UpdateChannel.Type;

export const UPDATE_CHECK_INTERVAL = Duration.hours(4);

export const UPDATE_CHECK_SCHEDULE = Schedule.spaced(UPDATE_CHECK_INTERVAL);

export const INSTALL_TIMEOUT = Duration.seconds(15);

export const CHANNEL_LABELS: Record<UpdateChannel, string> = {
  stable: 'Stable',
  beta: 'Beta',
  canary: 'Canary',
};

export const CHANNEL_RANKS: Record<UpdateChannel, number> = { stable: 0, beta: 1, canary: 2 };

export const UpdateState = Schema.Union([
  Schema.Struct({ status: Schema.Literal('idle') }),
  Schema.Struct({ status: Schema.Literal('checking'), manual: Schema.Boolean }),
  Schema.Struct({ status: Schema.Literal('downloading'), version: Schema.String, percent: Schema.Number }),
  Schema.Struct({ status: Schema.Literal('preparing'), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal('ready'), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal('installing'), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal('current'), latest: Schema.NullOr(Schema.String) }),
  Schema.Struct({ status: Schema.Literal('downgrade'), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal('failed'), message: Schema.String }),
]);

export type UpdateState = typeof UpdateState.Type;

export const BUSY_STATUSES: ReadonlySet<UpdateState['status']> = new Set([
  'downloading',
  'preparing',
  'ready',
  'installing',
]);

export interface UpdateMenuItem {
  label: string;
  enabled: boolean;
  install: boolean;
}

export interface UpdateNotice {
  title: string;
  body: string;
}

export const DOWNGRADE_ACCEPT = 0;

export const UPDATE_FAILURE_FALLBACK = 'The update server did not answer. Try again later.';

export const UpdateEvent = Schema.Union([
  Schema.TaggedStruct('Available', { version: Schema.String }),
  Schema.TaggedStruct('Progress', { percent: Schema.Number }),
  Schema.TaggedStruct('NotAvailable', { version: Schema.String }),
  Schema.TaggedStruct('Downloaded', { version: Schema.String }),
  Schema.TaggedStruct('Failed', { message: Schema.String }),
  Schema.TaggedStruct('Staged', {}),
  Schema.TaggedStruct('QuittingToInstall', {}),
  Schema.TaggedStruct('Log', { level: LogLevel, message: Schema.Unknown }),
]);

export type UpdateEvent = typeof UpdateEvent.Type;

export const UpdaterOptions = Schema.Struct({
  channel: Schema.String,
  allowPrerelease: Schema.Boolean,
  allowDowngrade: Schema.Boolean,
});

export type UpdaterOptions = typeof UpdaterOptions.Type;

export class UpdateCheckFailed extends Schema.TaggedError<
  UpdateCheckFailed,
  { readonly brand: unique symbol }
>()('UpdateCheckFailed', { message: Schema.String }) {}

export interface Download {
  readonly cancel: Effect.Effect<void>;
  readonly done: Effect.Effect<void>;
}

export const UpdateSnapshot = Schema.Struct({
  state: UpdateState,
  channel: UpdateChannel,
  supported: Schema.Boolean,
});

export type UpdateSnapshot = typeof UpdateSnapshot.Type;

export const STAGED_LOG = 'Squirrel: update staged';

export const QUITTING_LOG = 'Squirrel: quitting to install';
