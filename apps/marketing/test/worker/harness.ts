import { Effect, Layer, Option } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { respondWorker, WorkerLayer } from '../../src/worker/app.ts';
import type { AssetsBinding, BucketBinding, CacheBinding } from '../../src/worker/platform/schema.ts';
import { WorkerBindings } from '../../src/worker/platform/service.ts';

export interface TestWorld {
  bucket?: BucketBinding | null;
  cache?: CacheBinding | null;
  assets?: AssetsBinding['fetch'];
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

const noAssets: AssetsBinding['fetch'] = () => Promise.reject(new Error('no assets in this test'));

const offline = () => Promise.reject(new Error('network down'));

export function respond(request: Request, world: TestWorld) {
  const fetchFeed = world.fetch ?? offline;
  const bindings = Layer.succeed(WorkerBindings, {
    assets: { fetch: world.assets ?? noAssets },
    downloads: Option.fromNullishOr(world.bucket),
    cache: Option.fromNullishOr(world.cache),
  });
  const outbound = Layer.succeed(FetchHttpClient.Fetch, ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchFeed(String(input), init ?? {})) as typeof globalThis.fetch);
  return Effect.runPromise(
    respondWorker(request).pipe(
      Effect.provide(Layer.mergeAll(WorkerLayer.pipe(Layer.provide(bindings)), outbound))
    )
  );
}
