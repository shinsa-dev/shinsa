import { type DiffFile, DomainError } from '@shinsa/core';
import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import type { DiffFailed } from './history/schema.ts';
import { History } from './history/service.ts';
import type { GitFailed } from './schema.ts';

const runDiff = <A>(effect: Effect.Effect<A, DiffFailed | GitFailed, History>) =>
  edgeRuntime.runPromise(
    effect.pipe(
      Effect.mapError((error) =>
        error._tag === 'DiffFailed' ? new DomainError({ code: 'diff_failed', message: error.message }) : error
      )
    )
  );

export function resolveCommitDiff(
  repoPath: string,
  base: string,
  head: string,
  signal?: AbortSignal,
  paths: readonly string[] | null = null
): Promise<DiffFile[]> {
  return runDiff(History.use((history) => history.commitDiff(repoPath, base, head, signal, paths)));
}

export function resolveWorkingDiff(
  worktree: string,
  base: string,
  paths: readonly string[] | null = null,
  signal?: AbortSignal
): Promise<DiffFile[]> {
  return runDiff(History.use((history) => history.workingDiff(worktree, base, paths, signal)));
}

export function readWorkingPatch(worktree: string, base: string, signal?: AbortSignal) {
  return runDiff(History.use((history) => history.workingPatch(worktree, base, signal)));
}
