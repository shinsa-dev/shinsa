import type { Repo } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import { Checkout } from './checkout/service.ts';

export function resolveFreeBranch(
  repo: Repo,
  branch: string,
  signal?: AbortSignal,
  head: string | null = null
) {
  return edgeRuntime.runPromise(
    Checkout.use((checkout) => checkout.resolveFreeBranch(repo, branch, signal, head))
  );
}

export function syncRemoteBranch(repo: Repo, branch: string, signal?: AbortSignal) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.syncRemoteBranch(repo, branch, signal)));
}

export function resolveStartPoint(repo: Repo, baseBranch: string | null, signal?: AbortSignal) {
  return edgeRuntime.runPromise(
    Checkout.use((checkout) => checkout.resolveStartPoint(repo, baseBranch, signal))
  );
}

export function prepareWorktree(path: string, signal?: AbortSignal) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.prepare(path, signal)));
}

export function createWorktree(
  repo: Repo,
  worktreesDir: string,
  taskId: string,
  branch: string,
  baseBranch: string | null,
  signal?: AbortSignal
) {
  return edgeRuntime.runPromise(
    Checkout.use((checkout) => checkout.create(repo, worktreesDir, taskId, branch, baseBranch, signal))
  );
}

export function refreshWorktree(repo: Repo, path: string, baseBranch: string | null, signal?: AbortSignal) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.refresh(repo, path, baseBranch, signal)));
}

export function removeWorktree(repo: Repo, path: string) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.remove(repo, path)));
}
