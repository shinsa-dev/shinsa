import type { ShinsaCommand, ShinsaEffect, ShinsaEvent } from '@shinsa/core';
import { Effect, Exit, Fiber, Layer, ManagedRuntime, Scope } from 'effect';
import { describeError, log } from '../log/index.ts';
import { JsonLogger } from '../log/service.ts';
import type { EventLog } from '../store/index.ts';
import type {
  DispatchOptions,
  EffectContext,
  EffectRetry,
  EngineOptions,
  StateListener,
  WrittenBriefing,
} from './engine/schema.ts';
import { EngineCore } from './engine/service.ts';
import { resolveEffectFailure } from './failures/classify.ts';

export type {
  DispatchOptions,
  EffectContext,
  EffectRetry,
  EngineOptions,
  StateChange,
  StateListener,
} from './engine/schema.ts';

type EffectHandler = (effect: ShinsaEffect, context: EffectContext) => Promise<void>;

type ExhaustedHandler = (effect: ShinsaEffect, error: string, key: string) => Promise<void>;

type RetryHandler = (effect: ShinsaEffect, retry: EffectRetry, key: string) => Promise<void>;

export class Engine {
  readonly #runtime: ManagedRuntime.ManagedRuntime<EngineCore, never>;
  readonly #core: EngineCore['Service'];
  readonly #lingering = new Set<Promise<void>>();
  #stopping: Fiber.Fiber<void> | null = null;

  constructor(eventLog: EventLog, options: EngineOptions = {}) {
    const core = EngineCore.layer(options).pipe(
      Layer.provide(Layer.succeedContext(eventLog.context)),
      Layer.orDie
    );
    this.#runtime = ManagedRuntime.make(Layer.mergeAll(core, JsonLogger));
    this.#core = this.#runtime.runSync(EngineCore.use(Effect.succeed));
  }

  get readOnly() {
    return this.#core.readOnly;
  }

  get state() {
    return this.#runtime.runSync(this.#core.state);
  }

  get problems() {
    return this.#core.problems;
  }

  writeSnapshot() {
    return this.#runtime.runSync(this.#core.writeSnapshot);
  }

  onEffect(handler: EffectHandler) {
    const lingering = this.#lingering;
    this.#runtime.runSync(
      this.#core.replaceHandlers({
        apply: (effect, attempt) =>
          Effect.tryPromise({
            try: (signal) => {
              const work = Promise.try(() => handler(effect, { ...attempt, signal }));
              const settled = work.then(
                () => undefined,
                (error: unknown) => {
                  if (!signal.aborted) return;
                  log.warn('[Engine] A cancelled effect failed after it was cancelled', {
                    kind: effect.kind,
                    error: describeError(error),
                  });
                }
              );
              lingering.add(settled);
              void settled.then(() => lingering.delete(settled));
              return work;
            },
            catch: resolveEffectFailure,
          }),
      })
    );
  }

  onEffectExhausted(handler: ExhaustedHandler) {
    this.#runtime.runSync(
      this.#core.replaceHandlers({
        exhausted: (effect, error, key) =>
          Effect.tryPromise({ try: () => handler(effect, error, key), catch: resolveEffectFailure }),
      })
    );
  }

  onEffectRetry(handler: RetryHandler) {
    this.#runtime.runSync(
      this.#core.replaceHandlers({
        retry: (effect, retry, key) =>
          Effect.tryPromise({ try: () => handler(effect, retry, key), catch: resolveEffectFailure }),
      })
    );
  }

  subscribe(listener: StateListener) {
    const scope = this.#runtime.runSync(Scope.make());
    this.#runtime.runSync(this.#core.observe(listener).pipe(Scope.provide(scope)));
    return () => {
      this.#runtime.runSync(Scope.close(scope, Exit.void));
    };
  }

  start() {
    this.#runtime.runSync(this.#core.start);
  }

  stop() {
    this.#stopping ??= this.#runtime.runFork(this.#core.stop);
  }

  settle() {
    const stopping = this.#stopping;
    const lingering = this.#lingering;
    const core = this.#core;
    return this.#runtime.runPromise(
      Effect.gen(function* () {
        if (stopping) yield* Fiber.await(stopping);
        yield* core.settle;
        yield* Effect.promise(() => Promise.allSettled([...lingering]));
      })
    );
  }

  dispatch(command: ShinsaCommand, options: DispatchOptions = {}): Promise<ShinsaEvent[]> {
    return this.#runtime.runPromise(this.#core.dispatch(command, options));
  }

  writeBriefing(projectId: string | null, written: WrittenBriefing) {
    return this.#runtime.runPromise(this.#core.writeBriefing(projectId, written));
  }

  hasReceipt(id: string) {
    return this.#runtime.runSync(this.#core.hasReceipt(id));
  }
}
