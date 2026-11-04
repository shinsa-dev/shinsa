import type { DomainError, ShinsaCommand } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import type { EngineStopped } from '../../runtime/engine/schema.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { isSteerable, resolveAttemptKey } from '../active/run.ts';
import { type ActiveRun } from '../active/schema.ts';
import { LiveRuns } from '../active/service.ts';
import { resolveDelivery } from '../delegations/delivery.ts';
import { type Delivery } from '../delegations/schema.ts';
import { Transcripts } from '../transcripts/service.ts';

export class Deliveries extends Context.Service<
  Deliveries,
  {
    readonly deliver: (runId: string, generation: number) => Effect.Effect<void, DomainError | EngineStopped>;
    readonly wake: (runId: string, generation: number) => Effect.Effect<void, DomainError | EngineStopped>;
    readonly steer: (
      runId: string,
      active: ActiveRun,
      delivery: Delivery
    ) => Effect.Effect<void, DomainError | EngineStopped>;
    readonly confirmWake: (runId: string, active: ActiveRun) => Effect.Effect<void>;
    readonly release: (
      runId: string,
      active: ActiveRun,
      undelivered: string[]
    ) => Effect.Effect<string[], DomainError | EngineStopped>;
  }
>()('shinsa/engine/agents/deliveries/Deliveries') {
  static readonly layer = Layer.effect(
    Deliveries,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const runs = yield* LiveRuns;
      const transcripts = yield* Transcripts;
      const live = runs.active;

      const dispatch = (command: ShinsaCommand, id: string) =>
        engine.dispatch(command, { id }).pipe(Effect.asVoid);

      const recordUndelivered = (runId: string, generation: number) =>
        dispatch(
          { type: 'delegation.release', runId, generation, items: [] },
          `delegation.release:${runId}:${generation}`
        );

      const recordDelivered = (runId: string, delivery: Delivery) =>
        dispatch(
          {
            type: 'delegation.record_delivery',
            runId,
            generation: delivery.generation,
            items: delivery.items,
          },
          `delegation.record_delivery:${runId}:${delivery.generation}`
        );

      const recordReported = Effect.fn('Deliveries.recordReported')(function* (
        runId: string,
        delivery: Delivery
      ) {
        if (delivery.runIds.length === 0) return;
        yield* transcripts.record(runId, {
          type: 'notice',
          notice: { kind: 'delegation', event: 'reported', runIds: delivery.runIds },
        });
      });

      const steer = Effect.fn('Deliveries.steer')(function* (
        runId: string,
        active: ActiveRun,
        delivery: Delivery
      ) {
        const steered = active.session ? yield* active.session.steer(delivery.text, 'shinsa') : false;
        if (!steered) return yield* recordUndelivered(runId, delivery.generation);
        active.steered.set(delivery.text, delivery.items);
        yield* recordReported(runId, delivery);
        yield* recordDelivered(runId, delivery);
      });

      const deliver = Effect.fn('Deliveries.deliver')(function* (runId: string, generation: number) {
        const state = yield* engine.state;
        const run = state.runs[runId];
        const delivery = run && run.endedAt === null ? resolveDelivery(state, run) : null;
        if (!delivery || delivery.generation !== generation) return;
        const active = live.get(runId);
        if (!active || !isSteerable(active)) return yield* recordUndelivered(runId, generation);
        if (!active.session) {
          active.held.push(delivery);
          return;
        }
        yield* steer(runId, active, delivery);
      });

      const wake = Effect.fn('Deliveries.wake')(function* (runId: string, generation: number) {
        const state = yield* engine.state;
        const run = state.runs[runId];
        if (!run || run.endedAt !== null || run.status !== 'waiting' || live.has(runId)) return;
        const delivery = resolveDelivery(state, run);
        if (delivery?.generation !== generation) return;
        yield* runs.execute(runId, delivery.text, delivery);
      });

      const confirmWake = Effect.fn('Deliveries.confirmWake')(function* (runId: string, active: ActiveRun) {
        const delivery = active.delivery;
        if (!delivery) return;
        active.delivery = null;
        yield* recordReported(runId, delivery);
        yield* recordDelivered(runId, delivery).pipe(
          Effect.catch((failure) =>
            Effect.logWarning('[Runs] Could not record a delivered report').pipe(
              Effect.annotateLogs({ runId, error: failure.message })
            )
          ),
          Effect.forkDetach
        );
      });

      const release = Effect.fn('Deliveries.release')(function* (
        runId: string,
        active: ActiveRun,
        undelivered: string[]
      ) {
        const items = undelivered.flatMap((text) => active.steered.get(text) ?? []);
        if (items.length > 0)
          yield* dispatch(
            { type: 'delegation.release', runId, generation: null, items },
            `delegation.release:${resolveAttemptKey(runId, active.attemptId)}:steered`
          );
        if (active.delivery) yield* recordUndelivered(runId, active.delivery.generation);
        for (const delivery of active.held.splice(0)) yield* recordUndelivered(runId, delivery.generation);
        return undelivered.filter((text) => !active.steered.has(text));
      });

      return Deliveries.of({ deliver, wake, steer, confirmWake, release });
    })
  );
}
