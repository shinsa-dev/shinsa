import { Duration, Schema } from 'effect';

export const PushFailureKind = Schema.Literals(['hook', 'network', 'non_fast_forward', 'other']);
export type PushFailureKind = typeof PushFailureKind.Type;

export class PushError extends Schema.TaggedError<PushError, { readonly brand: unique symbol }>()(
  'PushError',
  {
    kind: PushFailureKind,
    detail: Schema.String,
    output: Schema.String,
    message: Schema.String,
  }
) {}

export const BaseUpdate = Schema.Union([
  Schema.Struct({ status: Schema.Literals(['current', 'merged', 'skipped']) }),
  Schema.Struct({ status: Schema.Literal('conflicted'), files: Schema.mutable(Schema.Array(Schema.String)) }),
]);
export type BaseUpdate = typeof BaseUpdate.Type;

export const BundleBranch = Schema.Struct({
  taskId: Schema.String,
  branch: Schema.String,
  bases: Schema.Array(Schema.String),
});
export type BundleBranch = typeof BundleBranch.Type;

export const REJECTED = /^\s*!\s+\[rejected\].*\((?:non-fast-forward|fetch first|stale info)\)/m;

export const REMOTE_REJECTED = /^\s*!\s+\[remote rejected\]/m;

export const GIT_LINE = /^(?:fatal:|ssh:|send-pack:|error: RPC failed)/;

export const NETWORK =
  /could not resolve host|unable to access '|could not read from remote repository|failed to connect to|connection timed out|connection refused|connection reset by peer|network is unreachable|the remote end hung up unexpectedly|rpc failed|the requested url returned error: (?:5\d\d|429)|authentication failed for|permission denied \(publickey|ssh: connect to host|temporary failure in name resolution|ssl certificate problem|operation timed out/i;

export const HOOK_FAILED = /husky - pre-push|pre-push (?:hook|script) (?:failed|declined)|\bhooks? failed\b/i;

export const PUSH_FAILED = /failed to push some refs/;

export const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export const DETAIL_LIMIT = 160;

export const TAIL_LINES = 80;

export const TAIL_CHARS = 6_000;

export const PUSH_SUMMARY: Record<'hook' | 'non_fast_forward', string> = {
  hook: 'the pre-push hook failed',
  non_fast_forward: 'the branch on the remote has commits this branch does not have',
};

export const FETCH_TIMEOUT = Duration.minutes(2);

export const MISSING_REMOTE_REF = /couldn't find remote ref/i;

export const LOCAL_DEFAULTS = ['main', 'master'];

export const TRIAL_IDENTITY = {
  GIT_AUTHOR_NAME: 'Shinsa',
  GIT_AUTHOR_EMAIL: 'shinsa@localhost',
  GIT_COMMITTER_NAME: 'Shinsa',
  GIT_COMMITTER_EMAIL: 'shinsa@localhost',
};
