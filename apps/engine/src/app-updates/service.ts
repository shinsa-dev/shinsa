import { DomainError } from '@shinsa/core';
import type {
  AppUpdateReport,
  AppUpdateReportAnswer,
  AppUpdateRequest,
  AppUpdatesAnswer,
} from '@shinsa/core/engine-api/schema';
import { Clock, Context, Effect, Layer, Option, Ref } from 'effect';
import { EngineRestarter } from '../instance/restart/service.ts';
import {
  isReportFresh,
  resolveAppUpdatesView,
  resolveInstallProgress,
  resolveQueuedRequests,
} from './control.ts';
import {
  APP_MISSING,
  APP_NOT_RUNNING,
  APP_OPEN_FAILED_CODE,
  type AppUpdatesControl,
  type AppUpdatesInput,
  EMPTY_CONTROL,
  UPDATE_NOT_READY,
} from './schema.ts';

export class AppUpdates extends Context.Service<
  AppUpdates,
  {
    report(report: AppUpdateReport): Effect.Effect<AppUpdateReportAnswer>;
    readonly view: Effect.Effect<AppUpdatesAnswer>;
    request(request: AppUpdateRequest): Effect.Effect<AppUpdatesAnswer, DomainError>;
    readonly open: Effect.Effect<AppUpdatesAnswer, DomainError>;
  }
>()('shinsa/engine/app-updates/AppUpdates') {
  static readonly layer = (input: AppUpdatesInput) =>
    Layer.effect(
      AppUpdates,
      Effect.gen(function* () {
        const restarter = Option.getOrUndefined(yield* Effect.serviceOption(EngineRestarter));
        const control = yield* Ref.make<AppUpdatesControl>(EMPTY_CONTROL);

        const view = Effect.gen(function* () {
          return resolveAppUpdatesView(
            yield* Ref.get(control),
            input.app,
            input.engine,
            yield* Clock.currentTimeMillis
          );
        });

        const restartEngine = Effect.gen(function* () {
          yield* Effect.logInfo(
            '[AppUpdates] Shinsa for Mac installed a new version, so the engine restarts into it'
          );
          if (!restarter) return;
          yield* restarter
            .request('now')
            .pipe(
              Effect.catch((failure) =>
                Effect.logError('[AppUpdates] Could not restart after the update').pipe(
                  Effect.annotateLogs({ error: failure.message })
                )
              )
            );
        });

        const followInstall = Effect.fn('AppUpdates.followInstall')(function* (
          report: AppUpdateReport,
          now: number
        ) {
          const { install } = yield* Ref.get(control);
          if (!install) return;
          const progress = resolveInstallProgress(install, report, input.engine, now);
          if (progress === 'waiting') return;
          yield* Ref.update(control, (current) => ({ ...current, install: null }));
          if (progress === 'restart_engine') yield* restartEngine;
          if (progress === 'abandoned')
            yield* Effect.logWarning('[AppUpdates] The update did not install').pipe(
              Effect.annotateLogs({ version: install.to })
            );
        });

        const report = Effect.fn('AppUpdates.report')(function* (latest: AppUpdateReport) {
          const now = yield* Clock.currentTimeMillis;
          yield* followInstall(latest, now);
          const requests = yield* Ref.modify(control, (current) => [
            current.requests,
            {
              ...current,
              report: latest,
              reportedAt: now,
              requests: [],
              install:
                current.install && current.requests.some((request) => request.kind === 'install')
                  ? { ...current.install, handed: true }
                  : current.install,
            },
          ]);
          return { requests };
        });

        const assertRunning = Effect.fn('AppUpdates.assertRunning')(function* () {
          const current = yield* Ref.get(control);
          if (input.app === null && current.report === null) return yield* new DomainError(APP_MISSING);
          if (!isReportFresh(current, yield* Clock.currentTimeMillis))
            return yield* new DomainError(APP_NOT_RUNNING);
          return current;
        });

        const request = Effect.fn('AppUpdates.request')(function* (asked: AppUpdateRequest) {
          const current = yield* assertRunning();
          const now = yield* Clock.currentTimeMillis;
          const ready = current.report?.update.status === 'ready' ? current.report.update : null;
          if (asked.kind === 'install' && !ready) return yield* new DomainError(UPDATE_NOT_READY);
          yield* Ref.update(control, (latest) => ({
            ...latest,
            requests: resolveQueuedRequests(latest.requests, asked),
            install:
              asked.kind === 'install' && ready && current.report
                ? { from: current.report.version, to: ready.version, handed: false, requestedAt: now }
                : latest.install,
          }));
          yield* Effect.logInfo('[AppUpdates] Queued a request for Shinsa for Mac').pipe(
            Effect.annotateLogs({ kind: asked.kind })
          );
          return yield* view;
        });

        const open = Effect.gen(function* () {
          if (input.app === null) return yield* new DomainError(APP_MISSING);
          yield* input
            .open(input.app)
            .pipe(
              Effect.mapError(
                (failure) => new DomainError({ code: APP_OPEN_FAILED_CODE, message: failure.message })
              )
            );
          yield* Effect.logInfo('[AppUpdates] Opened Shinsa for Mac in the background');
          return yield* view;
        }).pipe(Effect.withSpan('AppUpdates.open'));

        return AppUpdates.of({ report, view, request, open });
      })
    );
}
