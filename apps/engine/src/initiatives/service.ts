import { listInitiatives } from '@shinsa/core';
import { Context, Effect, FiberMap, Layer, Ref } from 'effect';
import { EngineCore } from '../runtime/engine/service.ts';
import { LeadWakeDebounce } from './schema.ts';

export class LeadWakes extends Context.Service<
  LeadWakes,
  {
    schedule(initiativeId: string): Effect.Effect<void>;
    readonly recover: Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
  }
>()('shinsa/engine/initiatives/LeadWakes') {
  static readonly layer = Layer.effect(
    LeadWakes,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const debounce = yield* LeadWakeDebounce;
      const stopped = yield* Ref.make(false);
      const waiting = yield* FiberMap.make<string, void>();

      const wake = (initiativeId: string) =>
        engine.dispatch({ type: 'initiative.wake_lead', initiativeId }).pipe(
          Effect.asVoid,
          Effect.catch((failure) =>
            Effect.logWarning('[Leads] Could not wake the lead').pipe(
              Effect.annotateLogs({ initiativeId, error: failure.message })
            )
          )
        );

      const schedule = Effect.fn('LeadWakes.schedule')(function* (initiativeId: string) {
        if (yield* Ref.get(stopped)) return;
        yield* FiberMap.run(
          waiting,
          initiativeId,
          Effect.andThen(Effect.sleep(debounce), wake(initiativeId)),
          {
            onlyIfMissing: true,
          }
        );
      });

      const recover = Effect.gen(function* () {
        for (const initiative of listInitiatives(yield* engine.state)) {
          if (initiative.leadTaskId && (initiative.milestones ?? []).length > 0)
            yield* schedule(initiative.id);
        }
      });

      return LeadWakes.of({
        schedule,
        recover,
        stop: Effect.andThen(Ref.set(stopped, true), FiberMap.clear(waiting)),
      });
    })
  );
}
