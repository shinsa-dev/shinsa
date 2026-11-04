import type { Repo, Task, WorkspaceMode } from '@shinsa/core';
import { type Effect, Schema } from 'effect';
import type { MergeUnresolved } from '../git/checkout/schema.ts';
import type { BaseUpdate, PushError } from '../git/remote/schema.ts';
import type { GitFailed, RefNameInvalid } from '../git/schema.ts';
import type { WorktreeRootUnavailable } from './root/schema.ts';

export const WorkspaceCheckout = Schema.Struct({
  path: Schema.String,
  branch: Schema.String,
  returnBranch: Schema.optional(Schema.String),
});
export type WorkspaceCheckout = typeof WorkspaceCheckout.Type;

export class TaskCheckoutMissing extends Schema.TaggedError<
  TaskCheckoutMissing,
  { readonly brand: unique symbol }
>()('TaskCheckoutMissing', { message: Schema.String }) {}

export class CheckoutDirty extends Schema.TaggedError<CheckoutDirty, { readonly brand: unique symbol }>()(
  'CheckoutDirty',
  { path: Schema.String, message: Schema.String }
) {}

export class CheckoutOffBranch extends Schema.TaggedError<
  CheckoutOffBranch,
  { readonly brand: unique symbol }
>()('CheckoutOffBranch', {
  branch: Schema.String,
  current: Schema.NullOr(Schema.String),
  message: Schema.String,
}) {}

export interface CheckoutCommit {
  readonly treeHash: string | null;
  readonly files: string[];
  readonly undo: Effect.Effect<void, GitFailed>;
}

type WorkspaceFailure =
  | GitFailed
  | RefNameInvalid
  | PushError
  | MergeUnresolved
  | TaskCheckoutMissing
  | CheckoutDirty
  | CheckoutOffBranch
  | WorktreeRootUnavailable;

export interface Workspace {
  readonly mode: WorkspaceMode;
  prepare(repo: Repo, task: Task, signal?: AbortSignal): Effect.Effect<WorkspaceCheckout, WorkspaceFailure>;
  commit(repo: Repo, task: Task, message: string): Effect.Effect<CheckoutCommit, WorkspaceFailure>;
  push(repo: Repo, task: Task, signal?: AbortSignal): Effect.Effect<string, WorkspaceFailure>;
  remove(repo: Repo, task: Task): Effect.Effect<void, WorkspaceFailure>;
  writeEdit(
    repo: Repo,
    task: Task,
    path: string,
    write: Effect.Effect<boolean>
  ): Effect.Effect<void, WorkspaceFailure>;
  syncBase(
    repo: Repo,
    task: Task,
    base: string,
    onBehind: Effect.Effect<void>,
    signal?: AbortSignal
  ): Effect.Effect<BaseUpdate, WorkspaceFailure>;
}

export const NO_WORKTREE = 'The task has no worktree.';

export const NO_BRANCH_YET = 'The task has no branch yet.';
