import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { Checkout } from './checkout/service.ts';
import { HEAD_TIMEOUT } from './schema.ts';
import { Git } from './service.ts';

export function commitWorktree(path: string, message: string) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.commit(path, message)));
}

export function stashEdits(path: string, message: string) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.stash(path, message)));
}

export function resolveHead(path: string) {
  return edgeRuntime.runPromise(Checkout.use((checkout) => checkout.head(path)));
}

export function selectHead(path: string) {
  return edgeRuntime.runPromise(
    Git.use((git) => git.attempt(['rev-parse', 'HEAD'], path, { timeout: HEAD_TIMEOUT })).pipe(
      Effect.map((result) => (result.ok ? result.stdout : null))
    )
  );
}
