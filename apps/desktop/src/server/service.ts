import { EngineApi } from '@shinsa/core/engine-api';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { Files } from '../files/service.ts';
import { DesktopHost } from '../host/service.ts';
import { TrayQueue } from '../tray/schema.ts';
import { EngineUnreachable, HEALTH_TIMEOUT, HealthAnswer, type ServerHealth } from './schema.ts';
import { parseConfigPort, resolveConfigPath, resolveServerUrl } from './url.ts';

export class EngineServer extends Context.Service<
  EngineServer,
  {
    readonly origin: string;
    readonly requestHealth: Effect.Effect<ServerHealth, EngineUnreachable>;
    readonly requestQueue: Effect.Effect<TrayQueue, EngineUnreachable>;
  }
>()('shinsa/desktop/server/EngineServer') {
  static readonly layer = Layer.effect(
    EngineServer,
    Effect.gen(function* () {
      const host = yield* DesktopHost;
      const files = yield* Files;
      const configText = yield* files.readText(resolveConfigPath(host.env, host.home));
      const origin = resolveServerUrl({
        env: host.env,
        packaged: host.packaged,
        configPort: parseConfigPort(Option.getOrNull(configText)),
      });
      const httpClient = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.prependUrl(origin)),
        HttpClient.filterStatusOk
      );
      const server = yield* HttpApiClient.group(EngineApi, { group: 'server', httpClient });
      const decodeHealth = Schema.decodeUnknownEffect(HealthAnswer);
      const decodeQueue = Schema.decodeUnknownEffect(TrayQueue);
      const reach = <A, E, B>(
        request: Effect.Effect<A, E>,
        decode: (answer: A) => Effect.Effect<B, Schema.SchemaError>
      ) =>
        request.pipe(
          Effect.mapError(() => new EngineUnreachable({ origin, reason: 'refused' })),
          Effect.timeoutOrElse({
            duration: HEALTH_TIMEOUT,
            orElse: () => Effect.fail(new EngineUnreachable({ origin, reason: 'timeout' })),
          }),
          Effect.flatMap((answer) =>
            decode(answer).pipe(Effect.mapError(() => new EngineUnreachable({ origin, reason: 'invalid' })))
          )
        );
      return EngineServer.of({
        origin,
        requestHealth: reach(server.health(), decodeHealth).pipe(
          Effect.withSpan('EngineServer.requestHealth')
        ),
        requestQueue: reach(server.queue(), decodeQueue).pipe(Effect.withSpan('EngineServer.requestQueue')),
      });
    })
  );
}
