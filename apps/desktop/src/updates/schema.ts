import { Schema } from 'effect';

export const UPDATE_FEED = {
  provider: 'generic',
  url: 'https://shinsa.dev/updates',
  useMultipleRangeRequest: false,
} as const;

export const UpdateChannel = Schema.Literals(['stable', 'beta', 'canary']);

export type UpdateChannel = typeof UpdateChannel.Type;

export const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;

export const INSTALL_TIMEOUT_MS = 15_000;

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

export const UPDATE_LOG = { file: 'updater.log', previous: 'updater.old.log', limit: 1_000_000 };

export const LogLevel = Schema.Literals(['debug', 'info', 'warn', 'error']);

export type LogLevel = typeof LogLevel.Type;
