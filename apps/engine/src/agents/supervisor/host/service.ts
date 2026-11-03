import { Context, Duration, Effect, FiberSet, Layer, Ref } from 'effect';
import { OPEN_CONTROL, type RunHostShape, type RunParts } from '../schema.ts';
import { makeTaskScopes } from '../scopes.ts';

export class RunHost extends Context.Service<RunHost, RunHostShape>()(
  'shinsa/engine/agents/supervisor/host/RunHost'
) {
  static layer(parts: RunParts) {
    return Layer.effect(
      RunHost,
      Effect.gen(function* () {
        const scopes = yield* makeTaskScopes(Duration.millis(parts.limits.stopMs));
        const control = yield* Ref.make(OPEN_CONTROL);
        const fibers = yield* FiberSet.make<void, unknown>();
        return RunHost.of({ ...parts, scopes, control, fibers });
      })
    );
  }
}
