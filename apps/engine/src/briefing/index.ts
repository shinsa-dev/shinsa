import type { Queue, ShinsaState } from '@shinsa/core';
import { Duration, Effect, Scope } from 'effect';
import type { QuickJson } from '../agents/quick/index.ts';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Engine } from '../runtime/engine.ts';
import { resolveBriefingAnswer } from './resolve.ts';
import {
  BRIEFING_DEBOUNCE,
  BriefingAskFailed,
  type BriefingAsk,
  type BriefingOptions,
  type BriefingsHandle,
  BriefingWriteFailed,
} from './schema.ts';
import { makeBriefings } from './service.ts';

export { describeBriefingPrompt } from './prompt.ts';
export type { BriefingOptions } from './schema.ts';

function enterAsk(ask: QuickJson): BriefingAsk {
  return (system, prompt, schema) =>
    Effect.tryPromise({
      try: () => ask<unknown>(system, prompt, schema),
      catch: (error) => new BriefingAskFailed({ message: describeError(error) }),
    });
}

export function resolveBriefing(state: ShinsaState, queue: Queue, now: number, ask: QuickJson) {
  return edgeRuntime.runPromise(resolveBriefingAnswer(state, queue, now, enterAsk(ask)));
}

export class Briefings {
  readonly #handle: BriefingsHandle;

  constructor(engine: Engine, options: BriefingOptions) {
    this.#handle = edgeRuntime.runSync(
      makeBriefings({
        state: Effect.sync(() => engine.state),
        ask: enterAsk(options.ask),
        write: (projectId, written) =>
          Effect.tryPromise({
            try: () => engine.writeBriefing(projectId, written),
            catch: (error) => new BriefingWriteFailed({ message: describeError(error) }),
          }),
        debounce: options.debounceMs === undefined ? BRIEFING_DEBOUNCE : Duration.millis(options.debounceMs),
      }).pipe(Scope.provide(edgeRuntime.runSync(Scope.make())))
    );
  }

  schedule() {
    edgeRuntime.runSync(this.#handle.schedule);
  }

  stop() {
    edgeRuntime.runSync(this.#handle.stop);
  }
}
