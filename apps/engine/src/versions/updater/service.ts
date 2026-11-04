import { homedir } from 'node:os';
import { Context, Effect, Layer } from 'effect';
import { type CommandResult, NOT_STARTED_EXIT_CODE } from '../../shell/schema.ts';
import { Shell } from '../../shell/service.ts';
import {
  type LineListener,
  UPDATE_ENV,
  UPDATE_TIMEOUT,
  type Updater,
  type VersionsCallFailed,
} from '../schema.ts';

export class UpdaterRunner extends Context.Service<
  UpdaterRunner,
  {
    run(
      updater: Updater,
      onLine: LineListener,
      cancel: Effect.Effect<void>
    ): Effect.Effect<CommandResult, VersionsCallFailed>;
  }
>()('shinsa/engine/versions/updater/UpdaterRunner') {
  static readonly layer = Layer.effect(
    UpdaterRunner,
    Effect.gen(function* () {
      const shell = yield* Shell;
      return UpdaterRunner.of({
        run: (updater, onLine, cancel) =>
          shell
            .run({
              argv: updater.command,
              cwd: homedir(),
              env: { ...UPDATE_ENV, ...updater.env },
              timeout: UPDATE_TIMEOUT,
              cancel,
              onLine: (line) => Effect.sync(() => onLine(line)),
            })
            .pipe(
              Effect.catchTag('CommandNotFound', (missing) =>
                Effect.succeed<CommandResult>({
                  ok: false,
                  code: NOT_STARTED_EXIT_CODE,
                  stdout: '',
                  stderr: missing.message,
                  timedOut: false,
                })
              )
            ),
      });
    })
  );
}
