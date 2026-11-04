import { Context, Effect, Layer } from 'effect';
import { WorkerBindings } from '../platform/service.ts';

export class Assets extends Context.Service<Assets, { fetch(request: Request): Effect.Effect<Response> }>()(
  'shinsa/marketing/worker/assets/Assets'
) {
  static readonly layer = Layer.effect(
    Assets,
    Effect.gen(function* () {
      const { assets } = yield* WorkerBindings;
      return Assets.of({ fetch: (request) => Effect.promise(() => assets.fetch(request)) });
    })
  );
}
