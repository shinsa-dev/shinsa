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
      const forget = Effect.fn('SharedTeams.forget')(function* (gone: readonly string[]) {
        const left = new Set(gone);
        const shared = (yield* engine.state).settings.sharedTeams ?? [];
        yield* engine.dispatch({
          type: 'settings.change',
          patch: { sharedTeams: shared.filter((teamId) => !left.has(teamId)) },
        });
        for (const teamId of gone) yield* remote.unshareTeam(teamId);
      });
      const sync = Effect.gen(function* () {
        const gone = yield* remote.syncSharedTeams((yield* engine.state).settings.sharedTeams ?? []);
        if (gone.length === 0) return;
        yield* forget(gone).pipe(
          Effect.catch((error) =>
            Effect.logWarning('[Remote] A team this machine left is still marked as shared').pipe(
              Effect.annotateLogs({ teams: gone.join(', '), error: error.message })
            )
          )
        );
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
