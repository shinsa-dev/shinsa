import type { AppUpdateRequest } from '@shinsa/core/engine-api/schema';
import { Effect, Layer, Option, Semaphore, Stream } from 'effect';
import { DesktopHost } from '../host/service.ts';
import { EngineServer } from '../server/service.ts';
import { Updater } from '../updates/service.ts';
import { resolveAppUpdateReport } from './report.ts';
import { UPDATE_REPORT_SCHEDULE } from './schema.ts';

export const UpdateLink = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* DesktopHost;
    const server = yield* EngineServer;
    const updater = yield* Updater;
    const serial = yield* Semaphore.make(1);
    const scope = yield* Effect.scope;

    const answer = Effect.fn('UpdateLink.answer')(function* (request: AppUpdateRequest) {
      yield* Effect.logInfo('[UpdateLink] Running a request from another device').pipe(
        Effect.annotateLogs({ kind: request.kind })
      );
      switch (request.kind) {
        case 'check':
          return yield* updater.check(false);
        case 'install':
          return yield* updater.install;
        case 'channel':
          return yield* updater.applyChannel(request.channel);
        case 'downgrade':
          return yield* updater.answerDowngrade(request.accept);
      }
    });

    const report = Effect.gen(function* () {
      const snapshot = yield* updater.snapshot;
      const answered = yield* Effect.option(
        server.reportUpdates(resolveAppUpdateReport(snapshot, host.version))
      );
      if (Option.isNone(answered) || answered.value.requests.length === 0) return;
      yield* Effect.forkIn(Effect.forEach(answered.value.requests, answer, { discard: true }), scope);
    }).pipe(Semaphore.withPermit(serial), Effect.withSpan('UpdateLink.report'));

    yield* Effect.forkScoped(Effect.repeat(report, UPDATE_REPORT_SCHEDULE), { startImmediately: true });
    yield* Effect.forkScoped(
      Stream.runForEach(Stream.drop(updater.changes, 1), () => report),
      { startImmediately: true }
    );
  })
);
