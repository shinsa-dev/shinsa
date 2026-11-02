import type { ShinsaEffect } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import type { EffectRetry } from '../../engine/schema.ts';
import { resolveShippingFailure } from '../../failures/classify.ts';
import type { EffectFailure } from '../../failures/schema.ts';
import { FAILURE_TITLE } from '../schema.ts';
import { EffectWorld } from '../world/service.ts';

export class EffectReports extends Context.Service<
  EffectReports,
  {
    retry(effect: ShinsaEffect, retry: EffectRetry, key: string): Effect.Effect<void, EffectFailure>;
    exhausted(effect: ShinsaEffect, error: string, key: string): Effect.Effect<void, EffectFailure>;
  }
>()('shinsa/engine/runtime/effects/reports/EffectReports') {
  static readonly layer = Layer.effect(
    EffectReports,
    Effect.gen(function* () {
      const world = yield* EffectWorld;

      const retry = Effect.fn('EffectReports.retry')(function* (
        effect: ShinsaEffect,
        retried: EffectRetry,
        key: string
      ) {
        if (effect.kind !== 'pull_request.open' && effect.kind !== 'pull_request.push') return;
        const failure = resolveShippingFailure('pushing', retried.failure, world.config.pushRetryMs);
        yield* world.dispatch(
          {
            type: 'pull_request.record_retry',
            taskId: effect.taskId,
            step: failure.step,
            attempt: retried.attempt,
            attempts: retried.attempts,
            retryAt: retried.retryAt,
            detail: failure.detail,
          },
          { id: `${key}:${retried.attempt}:pull_request.record_retry` }
        );
      });

      const exhausted = Effect.fn('EffectReports.exhausted')(function* (
        effect: ShinsaEffect,
        error: string,
        key: string
      ) {
        if (effect.kind === 'feedback.draft' || effect.kind === 'feedback.file') {
          yield* world.bridge(() => world.feedback.reportExhausted(effect.feedbackId, error, key));
          return;
        }
        switch (effect.kind) {
          case 'share.link':
            yield* world.dispatch(
              { type: 'share.fail', taskId: effect.taskId, detail: error },
              { id: `${key}:share.fail` }
            );
            return;
          case 'handoff.link':
            yield* world.dispatch(
              { type: 'handoff.fail', taskId: effect.taskId, detail: error },
              { id: `${key}:handoff.fail` }
            );
            return;
          case 'preview.link':
            yield* world.dispatch(
              { type: 'preview.fail', taskId: effect.taskId, serviceId: effect.serviceId, detail: error },
              { id: `${key}:preview.fail` }
            );
            return;
          default:
            break;
        }
        const title = FAILURE_TITLE[effect.kind];
        if (!title || !('taskId' in effect) || effect.taskId === null) return;
        yield* world.dispatch(
          { type: 'effect.fail', taskId: effect.taskId, title, detail: error },
          { id: `${key}:effect.fail` }
        );
      });

      return EffectReports.of({ retry, exhausted });
    })
  );
}
