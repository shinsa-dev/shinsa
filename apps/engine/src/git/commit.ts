import { edgeRuntime } from '../runtime/edge.ts';
import { Checkout } from './checkout/service.ts';

export function commitWorktree(path: string, message: string) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.commit(path, message)));
}

export function stashEdits(path: string, message: string) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.stash(path, message)));
}

export function resolveHead(path: string) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.head(path)));
}
