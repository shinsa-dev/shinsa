import { Schema } from 'effect';

export const LOCK_FILE = 'serve.lock';

export const BOOT_TOLERANCE_MS = 60_000;

export const TAKEOVER_ATTEMPTS = 3;

export const LockHolder = Schema.Struct({
  version: Schema.String,
  commit: Schema.NullOr(Schema.String),
  installPath: Schema.String,
  pid: Schema.Int,
  startedAt: Schema.Finite,
  port: Schema.Finite,
  url: Schema.String,
  bootedAt: Schema.Finite,
});

export type LockHolder = typeof LockHolder.Type;

export type LockOwner = Omit<LockHolder, 'bootedAt'>;

export interface LockAddress {
  port: number;
  url: string;
}

export interface LockOptions {
  isAlive?: (pid: number) => boolean;
  bootedAt?: number;
}

export class ServerRunning extends Schema.TaggedError<ServerRunning, { readonly brand: unique symbol }>()(
  'ServerRunning',
  { dataDir: Schema.String, holder: LockHolder }
) {}

export class LockContended extends Schema.TaggedError<LockContended, { readonly brand: unique symbol }>()(
  'LockContended',
  { dataDir: Schema.String }
) {}

export class LockFileFailed extends Schema.TaggedError<LockFileFailed, { readonly brand: unique symbol }>()(
  'LockFileFailed',
  { code: Schema.NullOr(Schema.String), message: Schema.String }
) {}
