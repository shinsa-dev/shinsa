import { Effect, Exit, Layer, Scope } from 'effect';
import type { ServerConfig } from '../config/index.ts';
import { resolveLockError } from '../instance/lock/index.ts';
import type { LockContended, ServerRunning } from '../instance/lock/schema.ts';
import { EngineLayer } from './layers.ts';
import type { ShinsaOptions } from './schema.ts';

function failLock(error: ServerRunning | LockContended) {
  return Effect.fail(resolveLockError(error));
}

export const runEngine = Effect.fn('Serve.runEngine')(function* (
  config: ServerConfig,
  options: ShinsaOptions = {}
) {
  const scope = yield* Scope.make();
  const stop = yield* Effect.cached(Scope.close(scope, Exit.void));
  yield* Layer.buildWithScope(EngineLayer(config, options, stop), scope).pipe(
    Effect.onError(() => stop),
    Effect.catchTags({ ServerRunning: failLock, LockContended: failLock })
  );
  return yield* Effect.never.pipe(Effect.ensuring(stop));
});
