import { Context, Layer, Logger, References } from 'effect';
import { ensure } from 'effect/Array';
import { HttpRouter, HttpServer } from 'effect/http';
import { Transcripts } from '../../src/agents/index.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { Ingress } from '../../src/http/ingress/middleware.ts';
import { RequestSource, type RequestSourceShape } from '../../src/http/schema.ts';
import type { HttpContext } from '../../src/http/server.ts';
import { HttpServices } from '../../src/http/services/service.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import { createTempDir, createTestConfig } from './index.ts';

export function createHttpContext(
  overrides: Partial<HttpContext> = {},
  config: Partial<ServerConfig> = {}
): HttpContext {
  const resolved = createTestConfig(createTempDir(), config);
  const engine = new Engine(new EventLog(resolved.databasePath));
  return {
    engine,
    config: resolved,
    transcripts: new Transcripts(resolved.transcriptsDir),
    evidence: new EvidenceStore(resolved.evidenceDir),
    models: { listModels: () => Promise.resolve([]) } as unknown as HttpContext['models'],
    onboarding: {} as HttpContext['onboarding'],
    ...overrides,
  };
}

const handlers: { dispose: () => Promise<void> }[] = [];

export const recordedLogs: { message: string; fields: Record<string, unknown> }[] = [];

const RecordingLogger = Logger.layer([
  Logger.make(({ fiber, message }) => {
    recordedLogs.push({
      message: ensure(message).map(String).join(' '),
      fields: { ...fiber.getRef(References.CurrentLogAnnotations) },
    });
  }),
]);

export async function disposeWebHandlers() {
  for (const handler of handlers.splice(0)) await handler.dispose();
  recordedLogs.splice(0);
}

type RouteNeeds =
  | HttpServices
  | HttpRouter.HttpRouter
  | Layer.Success<typeof HttpServer.layerServices>
  | HttpRouter.Request<'Requires' | 'Error' | 'GlobalRequires' | 'GlobalError', unknown>;

export function createWebHandler<E, R extends RouteNeeds>(
  context: HttpContext,
  routes: Layer.Layer<never, E, R>
) {
  const web = HttpRouter.toWebHandler(
    Layer.mergeAll(routes, Ingress).pipe(
      Layer.provide(HttpServices.layer(context)),
      Layer.provide(HttpServer.layerServices),
      Layer.provideMerge(RecordingLogger)
    ),
    { disableLogger: true }
  );
  handlers.push(web);
  const handle = web.handler as (request: Request, context: Context.Context<never>) => Promise<Response>;
  return (request: Request, source?: RequestSourceShape) =>
    handle(request, source ? Context.make(RequestSource, source) : Context.empty());
}
