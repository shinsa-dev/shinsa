import { DomainError, type ShinsaState } from '@shinsa/core';
import { Duration, Effect, Scope } from 'effect';
import { describeError, log } from '../log/index.ts';
import {
  type ClockDefaults,
  type ClockEntry,
  ClockTickFailed,
  MAX_CLOCK_DELAY,
  type StateClockHandle,
  type StateClockOptions,
} from './clock/schema.ts';
import { makeStateClock } from './clock/service.ts';
import { edgeRuntime } from './edge.ts';
import type { Engine } from './engine.ts';

export type { ClockDefaults, ClockEntry, StateClockOptions } from './clock/schema.ts';

export abstract class StateClock {
  protected readonly engine: Engine;
  protected readonly now: () => number;
  readonly #handle: StateClockHandle;
  #firing: Promise<void> | null = null;
  #settled = true;
  #unsubscribe: (() => void) | null = null;

  constructor(engine: Engine, defaults: ClockDefaults, options: StateClockOptions) {
    this.engine = engine;
    this.now = options.now ?? Date.now;
    const maxDelayMs = options.maxDelayMs ?? defaults.maxDelayMs;
    this.#handle = edgeRuntime.runSync(
      makeStateClock({
        now: Effect.sync(() => this.now()),
        minDelay: Duration.millis(options.minDelayMs ?? defaults.minDelayMs),
        maxDelay:
          maxDelayMs === undefined
            ? MAX_CLOCK_DELAY
            : Duration.min(Duration.millis(maxDelayMs), MAX_CLOCK_DELAY),
        list: Effect.sync(() =>
          this.listEntries(this.engine.state).map((entry) => ({
            id: entry.id,
            dueAt: entry.dueAt,
            fire: Effect.tryPromise({
              try: entry.fire,
              catch: (error) =>
                new ClockTickFailed({ message: describeError(error), refused: error instanceof DomainError }),
            }),
          }))
        ),
        report: (failure) =>
          Effect.sync(() => log.warn(`[${defaults.area}] ${defaults.failure}`, { error: failure.message })),
      }).pipe(Scope.provide(edgeRuntime.runSync(Scope.make())))
    );
  }

  protected abstract listEntries(state: ShinsaState): ClockEntry[];

  start() {
    if (this.#unsubscribe) return;
    this.#unsubscribe = this.engine.subscribe(() => {
      edgeRuntime.runFork(this.#handle.arm);
    });
    edgeRuntime.runFork(this.#handle.start);
  }

  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    edgeRuntime.runFork(this.#handle.stop);
  }

  protected refuse(id: string) {
    edgeRuntime.runSync(this.#handle.refuse(id));
  }

  fireDue() {
    if (this.#firing && !this.#settled) return this.#firing;
    this.#settled = false;
    this.#firing = edgeRuntime.runPromise(
      this.#handle.fireDue.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#settled = true;
          })
        )
      )
    );
    return this.#firing;
  }
}
