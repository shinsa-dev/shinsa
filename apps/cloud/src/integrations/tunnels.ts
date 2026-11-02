import { type InstanceId, resolveTunnelHost } from '@shinsa/core';
import { Context, Effect, Layer, Schema } from 'effect';
import { FetchHttpClient } from 'effect/http';

export class TunnelUnreachable extends Schema.TaggedError<TunnelUnreachable>()('TunnelUnreachable', {
  instanceId: Schema.String,
  message: Schema.String,
}) {}

export class Tunnels extends Context.Service<
  Tunnels,
  {
    request(
      instanceId: InstanceId,
      path: string,
      init: RequestInit
    ): Effect.Effect<Response, TunnelUnreachable>;
  }
>()('shinsa/cloud/integrations/Tunnels') {
  static readonly layer = Layer.effect(
    Tunnels,
    Effect.gen(function* () {
      const fetch = yield* FetchHttpClient.Fetch;
      return Tunnels.of({
        request: Effect.fn('Tunnels.request')((instanceId: InstanceId, path: string, init: RequestInit) =>
          Effect.tryPromise({
            try: () =>
              fetch(`https://${resolveTunnelHost(instanceId)}${path}`, { ...init, redirect: 'manual' }),
            catch: (cause) => new TunnelUnreachable({ instanceId, message: String(cause) }),
          })
        ),
      });
    })
  );
}
