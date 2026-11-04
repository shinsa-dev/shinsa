import { Schema } from 'effect';

const WorktreeRootSource = Schema.Literals(['environment', 'config', 'default']);

export const ResolvedWorktreeRoot = Schema.Struct({
  path: Schema.String,
  source: WorktreeRootSource,
});
export type ResolvedWorktreeRoot = typeof ResolvedWorktreeRoot.Type;

export class WorktreeRootUnavailable extends Schema.TaggedError<
  WorktreeRootUnavailable,
  { readonly brand: unique symbol }
>()('WorktreeRootUnavailable', { path: Schema.String, message: Schema.String }) {}

export const WORKTREE_ROOT_MARKER = '.shinsa-worktrees';

export const WORKTREE_ROOT_MARKER_TEXT =
  'Shinsa keeps task worktrees in this folder. Remove this file and Shinsa stops using it.\n';
