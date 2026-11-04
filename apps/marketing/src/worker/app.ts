import { Effect, Layer } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { Assets } from './assets/service.ts';
import { Bucket } from './bucket/service.ts';
import { EdgeCache } from './cache/service.ts';
import { Downloads } from './download/service.ts';
import { WorkerLogger } from './logger.ts';
import { isOpenPage } from './open/paths.ts';
import { OpenPage } from './open/service.ts';
import { ReleaseFeed } from './releases/service.ts';
import { isUpdatePath } from './updates/files.ts';
import { Updates } from './updates/service.ts';

const OutboundHttp = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(HttpClient.TracerPropagationEnabled, false))
);

export const WorkerLayer = Layer.mergeAll(Downloads.layer, Updates.layer, OpenPage.layer).pipe(
  Layer.provide(ReleaseFeed.layer),
  Layer.provide(Layer.mergeAll(Bucket.layer, EdgeCache.layer, Assets.layer, OutboundHttp)),
  Layer.provideMerge(WorkerLogger)
);

export const respondWorker = Effect.fn('respondWorker')(function* (request: Request) {
  const { pathname } = new URL(request.url);
  if (isOpenPage(pathname)) return yield* OpenPage.use((open) => open.respond(request));
  if (isUpdatePath(pathname)) return yield* Updates.use((updates) => updates.respond(request));
  return yield* Downloads.use((downloads) => downloads.respond(request));
});
