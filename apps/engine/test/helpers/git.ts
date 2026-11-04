import type { Repo } from '@shinsa/core';
import { Effect, Layer, type Scope } from 'effect';
import { ChecksLayer } from '../../src/checks/layers.ts';
import { Checkout } from '../../src/git/checkout/service.ts';
import { GitLayer } from '../../src/git/layers.ts';
import { Remote } from '../../src/git/remote/service.ts';
import { GitHubLayer } from '../../src/github/layers.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';

export const GitTestLayer = Layer.mergeAll(ChecksLayer, GitHubLayer).pipe(
  Layer.provideMerge(GitLayer),
  Layer.provideMerge(ShellLayer),
  Layer.provideMerge(JsonLogger)
);

export type GitTestServices = Layer.Success<typeof GitTestLayer>;

export function runGit<A, E>(
  effect: Effect.Effect<A, E, GitTestServices | Scope.Scope>,
  options?: { readonly signal?: AbortSignal }
) {
  return Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(GitTestLayer)), options);
}

export function createWorktree(
  repo: Repo,
  worktreesDir: string,
  taskId: string,
  branch: string,
  baseBranch: string | null
) {
  return runGit(Checkout.use((checkout) => checkout.create(repo, worktreesDir, taskId, branch, baseBranch)));
}

export function removeWorktree(repo: Repo, path: string) {
  return runGit(Checkout.use((checkout) => checkout.remove(repo, path)));
}

export function commitWorktree(path: string, message: string) {
  return runGit(Checkout.use((checkout) => checkout.commit(path, message)));
}

export function inspectRepo(path: string) {
  return runGit(Remote.use((remote) => remote.inspect(path)));
}
