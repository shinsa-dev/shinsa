import { Context, Effect, Layer, Queue, Stream } from 'effect';
import type { EngineAction } from '../engine/schema.ts';

export class EngineActions extends Context.Service<
  EngineActions,
  {
    request(action: EngineAction): Effect.Effect<void>;
    readonly requests: Stream.Stream<EngineAction>;
  }
>()('shinsa/desktop/engine-actions/EngineActions') {
  static readonly layer = Layer.effect(
    EngineActions,
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<EngineAction>();
      return EngineActions.of({
        request: (action) => Effect.asVoid(Queue.offer(queue, action)),
        requests: Stream.fromQueue(queue),
      });
    })
  );
}
