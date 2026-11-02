import type { ShinsaEffect } from '@shinsa/core';
import { Effect, Layer, ManagedRuntime } from 'effect';
import type { RunSupervisor } from '../agents/supervisor.ts';
import type { Briefings } from '../briefing/index.ts';
import type { ServerConfig } from '../config/index.ts';
import { JsonLogger } from '../log/service.ts';
import { CheckRuns } from './effects/checks/service.ts';
import { Cleanup } from './effects/cleanup/service.ts';
import { EditCommits } from './effects/edits/service.ts';
import { Merging } from './effects/merging/service.ts';
import { PullRequestSync } from './effects/pull-requests/service.ts';
import { EffectReports } from './effects/reports/service.ts';
import { EffectHandlers } from './effects/runner/service.ts';
import type { EffectRunnerOptions } from './effects/schema.ts';
import { TaskSetup } from './effects/setup/service.ts';
import { Shipping } from './effects/shipping/service.ts';
import { EffectWorld } from './effects/world/service.ts';
import type { Engine } from './engine.ts';
import type { EffectContext, EffectRetry } from './engine/schema.ts';

export type { EffectRunnerOptions } from './effects/schema.ts';

function awaitAbort(signal: AbortSignal) {
  return Effect.callback<void>((resume) => {
    if (signal.aborted) return resume(Effect.void);
    const abort = () => resume(Effect.void);
    signal.addEventListener('abort', abort, { once: true });
    return Effect.sync(() => signal.removeEventListener('abort', abort));
  });
}

export class EffectRunner {
  readonly #runtime: ManagedRuntime.ManagedRuntime<
    EffectHandlers | EffectReports | PullRequestSync | EffectWorld,
    never
  >;

  constructor(
    engine: Engine,
    config: ServerConfig,
    runs: RunSupervisor,
    briefings: Briefings,
    options: EffectRunnerOptions
  ) {
    const world = EffectWorld.layer(engine, config, runs, briefings, options);
    const shared = Layer.mergeAll(PullRequestSync.layer, EditCommits.layer).pipe(Layer.provideMerge(world));
    const areas = Layer.mergeAll(
      TaskSetup.layer,
      CheckRuns.layer,
      Shipping.layer,
      Merging.layer,
      Cleanup.layer,
      EffectReports.layer
    ).pipe(Layer.provideMerge(shared));
    this.#runtime = ManagedRuntime.make(
      Layer.mergeAll(EffectHandlers.layer.pipe(Layer.provideMerge(areas)), JsonLogger)
    );
  }

  apply(effect: ShinsaEffect, context: EffectContext): Promise<void> {
    if (context.signal.aborted) return Promise.resolve();
    const attempt = { key: context.key, attempt: context.attempt };
    return this.#runtime.runPromise(
      EffectHandlers.use((handlers) => handlers.apply(effect, attempt)).pipe(
        Effect.raceFirst(awaitAbort(context.signal))
      )
    );
  }

  startWatching() {
    this.#runtime.runSync(PullRequestSync.use((sync) => sync.startWatching));
  }

  stop() {
    return this.#runtime.runPromise(PullRequestSync.use((sync) => sync.stop));
  }

  reportRetry(effect: ShinsaEffect, retry: EffectRetry, key: string) {
    return this.#runtime.runPromise(EffectReports.use((reports) => reports.retry(effect, retry, key)));
  }

  reportExhausted(effect: ShinsaEffect, error: string, key: string) {
    return this.#runtime.runPromise(EffectReports.use((reports) => reports.exhausted(effect, error, key)));
  }

  recover() {
    return this.#runtime.runPromise(
      Effect.gen(function* () {
        const world = yield* EffectWorld;
        yield* world.bridge(() => world.feedback.recover());
        yield* (yield* PullRequestSync).syncAll;
      })
    );
  }

  syncAll() {
    return this.#runtime.runPromise(PullRequestSync.use((sync) => sync.syncAll));
  }

  syncPullRequest(taskId: string, force = false) {
    return this.#runtime.runPromise(PullRequestSync.use((sync) => sync.sync(taskId, force)));
  }

  dispose() {
    return this.#runtime.dispose();
  }
}
