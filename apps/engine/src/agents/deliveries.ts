import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { ActiveRun } from './active/schema.ts';
import type { Delivery } from './delegations/schema.ts';
import { DeliveryFailed, type DeliveriesHandle, type DeliveriesOptions } from './deliveries/schema.ts';
import { makeDeliveries } from './deliveries/service.ts';

export type { DeliveriesOptions } from './deliveries/schema.ts';

function fail(error: unknown) {
  return new DeliveryFailed({ message: describeError(error) });
}

export class Deliveries {
  readonly #handle: DeliveriesHandle;

  constructor({ engine, transcripts, active, execute }: DeliveriesOptions) {
    this.#handle = edgeRuntime.runSync(
      makeDeliveries({
        state: Effect.sync(() => engine.state),
        active,
        dispatch: (command, id) =>
          Effect.tryPromise({ try: () => engine.dispatch(command, { id }), catch: fail }).pipe(Effect.asVoid),
        execute: (runId, prompt, delivery) =>
          Effect.tryPromise({ try: () => execute(runId, prompt, delivery), catch: fail }),
        record: (runId, entry) => Effect.sync(() => transcripts.record(runId, entry)),
      })
    );
  }

  deliver(runId: string, generation: number) {
    return edgeRuntime.runPromise(this.#handle.deliver(runId, generation));
  }

  wake(runId: string, generation: number) {
    return edgeRuntime.runPromise(this.#handle.wake(runId, generation));
  }

  steer(runId: string, active: ActiveRun, delivery: Delivery) {
    return edgeRuntime.runPromise(this.#handle.steer(runId, active, delivery));
  }

  confirmWake(runId: string, active: ActiveRun) {
    edgeRuntime.runSync(this.#handle.confirmWake(runId, active));
  }

  release(runId: string, active: ActiveRun, undelivered: string[]) {
    return edgeRuntime.runPromise(this.#handle.release(runId, active, undelivered));
  }
}
