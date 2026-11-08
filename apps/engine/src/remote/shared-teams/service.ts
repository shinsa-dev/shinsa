import { Context, Effect, Layer } from 'effect';
import { EngineCore } from '../../runtime/engine/service.ts';
import { Remote } from '../machine/service.ts';

export class SharedTeams extends Context.Service<SharedTeams, { readonly sync: Effect.Effect<void> }>()(
  'shinsa/engine/remote/shared-teams/SharedTeams'
) {
  static readonly layer = Layer.effect(
    SharedTeams,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const remote = yield* Remote;
      const sync = Effect.gen(function* () {
        yield* remote.syncSharedTeams((yield* engine.state).settings.sharedTeams ?? []);
      }).pipe(Effect.withSpan('SharedTeams.sync'));
      const runFork = Effect.runForkWith(yield* Effect.context<never>());
      yield* remote.observe(
        Effect.sync(() => {
          runFork(sync);
        })
      );
      return SharedTeams.of({ sync });
    })
  );
}
