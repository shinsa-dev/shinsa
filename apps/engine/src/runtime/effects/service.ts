import type { PullRequest, ShinsaEffect } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import type { EffectAttempt, EffectRetry } from '../engine/schema.ts';
import { EngineCore } from '../engine/service.ts';
import { resolveEffectFailure } from '../failures/classify.ts';
import type { EffectFailure } from '../failures/schema.ts';
import { PullRequestSync } from './pull-requests/service.ts';
import { EffectReports } from './reports/service.ts';
import { EffectHandlers } from './runner/service.ts';
import { EffectWorld } from './world/service.ts';

export class EffectRunner extends Context.Service<
  EffectRunner,
  {
    apply(effect: ShinsaEffect, attempt: EffectAttempt): Effect.Effect<void, EffectFailure>;
    reportRetry(effect: ShinsaEffect, retry: EffectRetry, key: string): Effect.Effect<void, EffectFailure>;
    reportExhausted(effect: ShinsaEffect, error: string, key: string): Effect.Effect<void, EffectFailure>;
    readonly recover: Effect.Effect<void, EffectFailure>;
    readonly syncAll: Effect.Effect<void, EffectFailure>;
    syncPullRequest(taskId: string, force?: boolean): Effect.Effect<PullRequest | null, EffectFailure>;
    readonly startWatching: Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
  }
>()('shinsa/engine/runtime/effects/EffectRunner') {
  static readonly layer = Layer.effect(
    EffectRunner,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const handlers = yield* EffectHandlers;
      const reports = yield* EffectReports;
      const sync = yield* PullRequestSync;
      const world = yield* EffectWorld;
      yield* engine.replaceHandlers({
        apply: handlers.apply,
        exhausted: reports.exhausted,
        retry: reports.retry,
      });
      return EffectRunner.of({
        apply: handlers.apply,
        reportRetry: reports.retry,
        reportExhausted: reports.exhausted,
        recover: Effect.mapError(world.feedback.recover, resolveEffectFailure).pipe(
          Effect.andThen(sync.syncAll)
        ),
        syncAll: sync.syncAll,
        syncPullRequest: (taskId, force = false) => sync.sync(taskId, force),
        startWatching: sync.startWatching,
        stop: sync.stop,
      });
    })
  );
}
