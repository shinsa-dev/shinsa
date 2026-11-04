import { Effect, Layer, Option } from 'effect';
import { respondWorker, WorkerLayer } from './app.ts';
import type { AssetsBinding, BucketBinding, CacheBinding } from './platform/schema.ts';
import { WorkerBindings } from './platform/service.ts';

interface Env {
  ASSETS: AssetsBinding;
  DOWNLOADS?: BucketBinding;
}

function selectEdgeCache(): Option.Option<CacheBinding> {
  if (!('default' in caches)) return Option.none();
  return Option.some((caches as CacheStorage & { default: Cache }).default);
}

export default {
  fetch: (request: Request, env: Env) =>
    Effect.runPromise(
      respondWorker(request).pipe(
        Effect.provide(
          WorkerLayer.pipe(
            Layer.provide(
              Layer.succeed(WorkerBindings, {
                assets: env.ASSETS,
                downloads: Option.fromNullishOr(env.DOWNLOADS),
                cache: selectEdgeCache(),
              })
            )
          )
        )
      )
    ),
};
