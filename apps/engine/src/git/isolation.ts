import type { Repo } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import { Checkout } from './checkout/service.ts';

export { resolveIsolatedPath } from './checkout/paths.ts';

export function createIsolatedWorktree(
  repo: Repo,
  worktreesDir: string,
  taskId: string,
  runId: string,
  baseCommit: string
) {
  return edgeRuntime.runPromise(
    Checkout.use((checkout) => checkout.createIsolated(repo, worktreesDir, taskId, runId, baseCommit))
  );
}

export function describeIsolatedChanges(path: string) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.describeIsolated(path)));
}

export function removeIsolatedWorktrees(repo: Repo, worktreesDir: string, taskId: string) {
  return edgeRuntime.runPromise(
    Checkout.use((checkout) => checkout.removeIsolated(repo, worktreesDir, taskId))
  );
}
