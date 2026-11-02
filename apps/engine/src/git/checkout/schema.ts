import { Duration, Schema } from 'effect';

export const PendingMerge = Schema.Struct({ mergeHead: Schema.String, mergeMessage: Schema.String });
export type PendingMerge = typeof PendingMerge.Type;

export const CommitResult = Schema.Struct({ merge: Schema.NullOr(PendingMerge) });
export type CommitResult = typeof CommitResult.Type;

export const WorktreeCheckout = Schema.Struct({ path: Schema.String, branch: Schema.String });
export type WorktreeCheckout = typeof WorktreeCheckout.Type;

export const RegisteredWorktree = Schema.Struct({
  path: Schema.String,
  branch: Schema.NullOr(Schema.String),
});
export type RegisteredWorktree = typeof RegisteredWorktree.Type;

export class MergeUnresolved extends Schema.TaggedError<MergeUnresolved, { readonly brand: unique symbol }>()(
  'MergeUnresolved',
  { files: Schema.Array(Schema.String), message: Schema.String }
) {}

export class CommitInvalid extends Schema.TaggedError<CommitInvalid, { readonly brand: unique symbol }>()(
  'CommitInvalid',
  { commit: Schema.String, message: Schema.String }
) {}

export const COMMIT_ID = /^[0-9a-f]{7,64}$/;

export const GIT_NETWORK_TIMEOUT = Duration.minutes(2);

export const BRANCH_ATTEMPTS = 50;

export const REMOTE_MERGE_SUBJECT = /^Merge remote-tracking branch '[^/']+\/([^']+)'/;
