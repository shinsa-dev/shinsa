import { edgeRuntime } from '../runtime/edge.ts';
import type { PendingMerge } from './checkout/schema.ts';
import { Checkout } from './checkout/service.ts';

export function commitWorktree(path: string, message: string) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.commit(path, message)));
}

export function writeMergeHead(path: string, merge: PendingMerge) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.writeMergeHead(path, merge)));
}

export function listChangedFiles(path: string, from: string, to: string) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.listCommitFiles(path, from, to)));
}

export function stashEdits(path: string, message: string) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.stash(path, message)));
}

export function resolveHead(path: string) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.head(path)));
}

export function resolveTree(path: string) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.tree(path)));
}
