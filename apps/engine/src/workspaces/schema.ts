import type { Repo, Task } from '@shinsa/core';
import { type Effect, Schema } from 'effect';
import type { MergeUnresolved } from '../git/checkout/schema.ts';
import type { BaseUpdate, PushError } from '../git/remote/schema.ts';
import type { GitFailed, RefNameInvalid } from '../git/schema.ts';
import type { WorktreeRootUnavailable } from './root/schema.ts';

interface WorkspaceCheckout {
  readonly path: string;
  readonly branch: string;
}

export class TaskCheckoutMissing extends Schema.TaggedError<
  TaskCheckoutMissing,
  { readonly brand: unique symbol }
>()('TaskCheckoutMissing', { message: Schema.String }) {}

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
  | WorktreeRootUnavailable;

export interface Workspace {
  prepare(repo: Repo, task: Task, signal?: AbortSignal): Effect.Effect<WorkspaceCheckout, WorkspaceFailure>;
  commit(repo: Repo, task: Task, message: string): Effect.Effect<CheckoutCommit, WorkspaceFailure>;
  push(repo: Repo, task: Task, signal?: AbortSignal): Effect.Effect<string, WorkspaceFailure>;
  remove(repo: Repo, task: Task): Effect.Effect<void, WorkspaceFailure>;
  writeEdit<E>(
    repo: Repo,
    task: Task,
    path: string,
    write: Effect.Effect<boolean, E>
  ): Effect.Effect<void, WorkspaceFailure | E>;
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
