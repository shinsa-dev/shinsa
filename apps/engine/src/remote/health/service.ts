import { Context, Effect, Layer } from 'effect';
import { HttpClient } from 'effect/http';
import { HEALTH_TIMEOUT, type HealthCheck } from './schema.ts';

export class TunnelHealth extends Context.Service<TunnelHealth, HealthCheck>()(
  'shinsa/engine/remote/health/TunnelHealth'
) {
  static readonly layer = Layer.effect(
    TunnelHealth,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      return TunnelHealth.of({
        check: Effect.fn('TunnelHealth.check')(function* (url: string) {
          return yield* http.get(url).pipe(
            Effect.timeout(HEALTH_TIMEOUT),
            Effect.map((response) => response.status >= 200 && response.status < 300),
            Effect.orElseSucceed(() => false)
          );
        }),
      });
    })
  );
}
