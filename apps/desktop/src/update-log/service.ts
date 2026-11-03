import { join } from 'node:path';
import { Context, DateTime, Effect, Layer, Option } from 'effect';
import { Files } from '../files/service.ts';
import { DesktopHost } from '../host/service.ts';
import { formatLogLine, needsLogRotation } from './log.ts';
import { type LogLevel, UPDATE_LOG } from './schema.ts';

export class UpdateLog extends Context.Service<
  UpdateLog,
  {
    readonly rotate: Effect.Effect<void>;
    write(level: LogLevel, message: unknown): Effect.Effect<void>;
  }
>()('shinsa/desktop/update-log/UpdateLog') {
  static readonly layer = Layer.effect(
    UpdateLog,
    Effect.gen(function* () {
      const host = yield* DesktopHost;
      const files = yield* Files;
      const path = join(host.logsPath, UPDATE_LOG.file);
      const rotate = Effect.gen(function* () {
        const size = yield* files.readSize(path);
        if (Option.isNone(size) || !needsLogRotation(size.value)) return;
        yield* Effect.ignore(files.rename(path, join(host.logsPath, UPDATE_LOG.previous)));
      });
      const write = Effect.fn('UpdateLog.write')(function* (level: LogLevel, message: unknown) {
        const now = yield* DateTime.now;
        yield* Effect.ignore(files.appendText(path, formatLogLine(level, message, DateTime.toDateUtc(now))));
      });
      return UpdateLog.of({ rotate: rotate.pipe(Effect.withSpan('UpdateLog.rotate')), write });
    })
  );
}
