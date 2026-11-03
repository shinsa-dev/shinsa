import { Effect } from 'effect';
import { isSteerable, resolveAttemptKey } from '../active/run.ts';
import { type ActiveRun } from '../active/schema.ts';
import { resolveDelivery } from '../delegations/delivery.ts';
import { type Delivery } from '../delegations/schema.ts';
import type { DeliveriesDefinition, DeliveriesHandle } from './schema.ts';

export const makeDeliveries = (definition: DeliveriesDefinition) => {
  const { active: live } = definition;

  const recordUndelivered = (runId: string, generation: number) =>
    definition.dispatch(
      { type: 'delegation.release', runId, generation, items: [] },
      `delegation.release:${runId}:${generation}`
    );

  const recordDelivered = (runId: string, delivery: Delivery) =>
    definition.dispatch(
      { type: 'delegation.record_delivery', runId, generation: delivery.generation, items: delivery.items },
      `delegation.record_delivery:${runId}:${delivery.generation}`
    );

  const recordReported = Effect.fn('Deliveries.recordReported')(function* (
    runId: string,
    delivery: Delivery
  ) {
    if (delivery.runIds.length === 0) return;
    yield* definition.record(runId, {
      type: 'notice',
      notice: { kind: 'delegation', event: 'reported', runIds: delivery.runIds },
    });
  });

  const steer = Effect.fn('Deliveries.steer')(function* (
    runId: string,
    active: ActiveRun,
    delivery: Delivery
  ) {
    const steered = yield* Effect.sync(() => active.session?.steer(delivery.text, 'shinsa') ?? false);
    if (!steered) return yield* recordUndelivered(runId, delivery.generation);
    active.steered.set(delivery.text, delivery.items);
    yield* recordReported(runId, delivery);
    yield* recordDelivered(runId, delivery);
  });

  const deliver = Effect.fn('Deliveries.deliver')(function* (runId: string, generation: number) {
    const state = yield* definition.state;
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
    const state = yield* definition.state;
    const run = state.runs[runId];
    if (!run || run.endedAt !== null || run.status !== 'waiting' || live.has(runId)) return;
    const delivery = resolveDelivery(state, run);
    if (delivery?.generation !== generation) return;
    yield* definition.execute(runId, delivery.text, delivery);
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
      yield* definition.dispatch(
        { type: 'delegation.release', runId, generation: null, items },
        `delegation.release:${resolveAttemptKey(runId, active.attemptId)}:steered`
      );
    if (active.delivery) yield* recordUndelivered(runId, active.delivery.generation);
    for (const delivery of active.held.splice(0)) yield* recordUndelivered(runId, delivery.generation);
    return undelivered.filter((text) => !active.steered.has(text));
  });

  const handle: DeliveriesHandle = { deliver, wake, steer, confirmWake, release };
  return Effect.succeed(handle);
};
