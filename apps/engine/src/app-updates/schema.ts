import type { ShinsaBuild } from '@shinsa/core';
import type { AppUpdateReport, AppUpdateRequest } from '@shinsa/core/engine-api/schema';
import { Duration, type Effect, Schema } from 'effect';

export const APP_REPORT_FRESH = Duration.seconds(15);

export const APP_INSTALL_WINDOW = Duration.minutes(5);

export const APP_OPEN_TIMEOUT_MS = 10_000;

export const APP_BUNDLE_MARKER = '.app/Contents/';

export class AppOpenFailed extends Schema.TaggedError<AppOpenFailed, { readonly brand: unique symbol }>()(
  'AppOpenFailed',
  { message: Schema.String }
) {}

export interface AppUpdatesInput {
  readonly app: string | null;
  readonly engine: ShinsaBuild;
  readonly open: (app: string) => Effect.Effect<void, AppOpenFailed>;
}

export interface AppInstall {
  readonly from: string;
  readonly to: string;
  readonly handed: boolean;
  readonly requestedAt: number;
}

export interface AppUpdatesControl {
  readonly report: AppUpdateReport | null;
  readonly reportedAt: number | null;
  readonly requests: readonly AppUpdateRequest[];
  readonly install: AppInstall | null;
}

export const EMPTY_CONTROL: AppUpdatesControl = {
  report: null,
  reportedAt: null,
  requests: [],
  install: null,
};

export type InstallProgress = 'waiting' | 'restart_engine' | 'installed' | 'abandoned';

export const APP_MISSING = {
  code: 'app_missing',
  message: 'This engine was not installed with Shinsa for Mac, so it updates from that machine.',
} as const;

export const APP_NOT_RUNNING = {
  code: 'app_not_running',
  message: 'Shinsa for Mac is not running on that machine. Open it first.',
} as const;

export const UPDATE_NOT_READY = {
  code: 'update_not_ready',
  message: 'No update is ready to install yet.',
} as const;

export const APP_OPEN_FAILED_CODE = 'app_open_failed';
