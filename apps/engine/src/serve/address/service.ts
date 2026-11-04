import { Context, Effect, Layer } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { resolveServerUrl } from '../../http/server/url.ts';

export class ServerAddress extends Context.Service<
  ServerAddress,
  {
    readonly url: Effect.Effect<string>;
    current(): string;
    replace(url: string): Effect.Effect<void>;
  }
>()('shinsa/engine/serve/address/ServerAddress') {
  static readonly layer = Layer.effect(
    ServerAddress,
    Effect.gen(function* () {
      const config = yield* EngineConfig;
      let url = resolveServerUrl(config.hostname, config.port);
      return ServerAddress.of({
        url: Effect.sync(() => url),
        current: () => url,
        replace: (next) =>
          Effect.sync(() => {
            url = next;
          }),
      });
    })
  );
}
