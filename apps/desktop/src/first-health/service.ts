import { Context, Effect, Fiber, Layer, type Option } from 'effect';
import type { ServerHealth } from '../server/schema.ts';
import { EngineServer } from '../server/service.ts';

export class FirstHealth extends Context.Service<
  FirstHealth,
  { readonly answer: Effect.Effect<Option.Option<ServerHealth>> }
>()('shinsa/desktop/first-health/FirstHealth') {
  static readonly layer = Layer.effect(
    FirstHealth,
    Effect.gen(function* () {
      const server = yield* EngineServer;
      const check = yield* Effect.forkScoped(Effect.option(server.requestHealth), { startImmediately: true });
      return FirstHealth.of({ answer: Fiber.join(check).pipe(Effect.withSpan('FirstHealth.answer')) });
    })
  );
}
