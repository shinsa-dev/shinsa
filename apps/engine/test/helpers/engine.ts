import type { ShinsaCommand, ShinsaEffect, ShinsaEvent } from '@shinsa/core';
import { Effect, Exit, Fiber, Layer, ManagedRuntime, Scope } from 'effect';
import { describeError, log } from '../../src/log/index.ts';
import { JsonLogger } from '../../src/log/service.ts';
import type {
  DispatchOptions,
  EffectContext,
  EffectRetry,
  EngineOptions,
  StateListener,
  WrittenBriefing,
} from '../../src/runtime/engine/schema.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { resolveEffectFailure } from '../../src/runtime/failures/classify.ts';
import type { EventLog } from '../../src/store/schema.ts';

type EffectHandler = (effect: ShinsaEffect, context: EffectContext) => Promise<void>;

type ExhaustedHandler = (effect: ShinsaEffect, error: string, key: string) => Promise<void>;

type RetryHandler = (effect: ShinsaEffect, retry: EffectRetry, key: string) => Promise<void>;

export interface EngineRunner {
  runSync<A, E>(effect: Effect.Effect<A, E>): A;
  runPromise<A, E>(effect: Effect.Effect<A, E>): Promise<A>;
  runFork<A, E>(effect: Effect.Effect<A, E>): Fiber.Fiber<A, E>;
}

interface RunningCore {
  readonly core: EngineCore['Service'];
  readonly runner: EngineRunner;
  readonly dispose: () => Promise<void>;
}

function isRunningCore(source: EventLog | RunningCore): source is RunningCore {
  return 'core' in source;
}

function openCore(eventLog: EventLog, options: EngineOptions): RunningCore {
  const layer = EngineCore.layer(options).pipe(
    Layer.provide(Layer.succeedContext(eventLog.context)),
    Layer.orDie
  );
  const runtime = ManagedRuntime.make(Layer.mergeAll(layer, JsonLogger));
  return {
    core: runtime.runSync(EngineCore.use(Effect.succeed)),
    runner: runtime,
    dispose: () => runtime.dispose(),
  };
}

export class Engine {
  readonly #running: RunningCore;
  readonly #lingering = new Set<Promise<void>>();
  #stopping: Fiber.Fiber<void> | null = null;

  constructor(source: EventLog | RunningCore, options: EngineOptions = {}) {
    this.#running = isRunningCore(source) ? source : openCore(source, options);
  }

  get core() {
    return this.#running.core;
  }

  get readOnly() {
    return this.core.readOnly;
  }

  get state() {
    return this.#running.runner.runSync(this.core.state);
  }

  get problems() {
    return this.core.problems;
  }

  writeSnapshot() {
    return this.#running.runner.runSync(this.core.writeSnapshot);
  }

  onEffect(handler: EffectHandler) {
    const lingering = this.#lingering;
    this.#running.runner.runSync(
      this.core.replaceHandlers({
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
    this.#running.runner.runSync(
      this.core.replaceHandlers({
        exhausted: (effect, error, key) =>
          Effect.tryPromise({ try: () => handler(effect, error, key), catch: resolveEffectFailure }),
      })
    );
  }

  onEffectRetry(handler: RetryHandler) {
    this.#running.runner.runSync(
      this.core.replaceHandlers({
        retry: (effect, retry, key) =>
          Effect.tryPromise({ try: () => handler(effect, retry, key), catch: resolveEffectFailure }),
      })
    );
  }

  subscribe(listener: StateListener) {
    const { runner } = this.#running;
    const scope = runner.runSync(Scope.make());
    runner.runSync(this.core.observe(listener).pipe(Scope.provide(scope)));
    return () => {
      runner.runSync(Scope.close(scope, Exit.void));
    };
  }

  start() {
    this.#running.runner.runSync(this.core.start);
  }

  stop() {
    this.#stopping ??= this.#running.runner.runFork(this.core.stop);
  }

  settle() {
    const stopping = this.#stopping;
    const lingering = this.#lingering;
    const core = this.core;
    return this.#running.runner.runPromise(
      Effect.gen(function* () {
        if (stopping) yield* Fiber.await(stopping);
        yield* core.settle;
        yield* Effect.promise(() => Promise.allSettled([...lingering]));
      })
    );
  }

  dispatch(command: ShinsaCommand, options: DispatchOptions = {}): Promise<ShinsaEvent[]> {
    return this.#running.runner.runPromise(this.core.dispatch(command, options));
  }

  writeBriefing(projectId: string | null, written: WrittenBriefing) {
    return this.#running.runner.runPromise(this.core.writeBriefing(projectId, written));
  }

  hasReceipt(id: string) {
    return this.#running.runner.runSync(this.core.hasReceipt(id));
  }

  dispose() {
    return this.#running.dispose();
  }
}
