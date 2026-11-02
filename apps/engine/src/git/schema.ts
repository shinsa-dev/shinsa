import { Duration, type Effect, Schedule, Schema } from 'effect';
import type { CommandEnv } from '../shell/schema.ts';

export class GitFailed extends Schema.TaggedError<GitFailed, { readonly brand: unique symbol }>()(
  'GitFailed',
  {
    message: Schema.String,
    retryable: Schema.Boolean,
  }
) {}

export class RefNameInvalid extends Schema.TaggedError<RefNameInvalid, { readonly brand: unique symbol }>()(
  'RefNameInvalid',
  { ref: Schema.String, message: Schema.String }
) {}

export const SAFE_REF = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]+(?<!\.lock)(?<![./])$/;

export const RefName = Schema.String.check(Schema.isPattern(SAFE_REF)).pipe(Schema.brand('RefName'));
export type RefName = typeof RefName.Type;

export const GitRead = Schema.Struct({
  ok: Schema.Boolean,
  code: Schema.Number,
  bytes: Schema.Uint8Array,
  stderr: Schema.String,
  timedOut: Schema.Boolean,
  truncated: Schema.Boolean,
});
export type GitRead = typeof GitRead.Type;

export interface GitRun {
  readonly input?: string | undefined;
  readonly env?: CommandEnv | undefined;
  readonly timeout?: Duration.Duration | null | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface GitReadRequest {
  readonly timeout?: Duration.Duration | undefined;
  readonly maxBytes?: number | undefined;
  readonly maxLines?: number | undefined;
  readonly literal?: boolean | undefined;
  readonly env?: CommandEnv | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onData?: ((chunk: Uint8Array) => Effect.Effect<void>) | undefined;
}

export const LOCKED = /Unable to create '[^']*\.lock': File exists/;

const LOCK_BACKOFF = Duration.millis(50);

const LOCK_RETRIES = 5;

export const LOCK_RETRY = Schedule.max([
  Schedule.exponential(LOCK_BACKOFF),
  Schedule.recurs(LOCK_RETRIES),
]).pipe(
  Schedule.setInputType<GitFailed>(),
  Schedule.while(({ input }) => input.retryable)
);

export const READ_ENV: CommandEnv = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat' };

export const NEWLINE = 10;

export const NOT_STARTED_READ = 127;

export const CANCELLED_READ = 130;

export const CANCELLED_READ_MESSAGE = 'The read was cancelled.';
