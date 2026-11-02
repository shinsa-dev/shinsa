import { Context, Effect, FiberSet, Layer } from 'effect';
import type { RunHostShape, RunParts } from '../schema.ts';
import { makeTaskScopes } from '../service.ts';

export class RunHost extends Context.Service<RunHost, RunHostShape>()(
  'shinsa/engine/agents/supervisor/host/RunHost'
) {
  static layer(parts: RunParts) {
    return Layer.effect(
      RunHost,
      Effect.gen(function* () {
        const scopes = yield* makeTaskScopes();
        const fibers = yield* FiberSet.make<void, unknown>();
        return RunHost.of({ ...parts, scopes, fibers });
      })
    );
  }
}
