import { Context, Effect, Layer } from 'effect';
import { resolveCancel } from '../../shell/abort.ts';
import {
  CANCELLED_BEFORE_START,
  CANCELLED_EXIT_CODE,
  type CommandResult,
  NOT_STARTED_EXIT_CODE,
} from '../../shell/schema.ts';
import { Shell } from '../../shell/service.ts';
import { GITHUB_TIMEOUT, type GitHubAnswer, type GitHubRun } from '../schema.ts';

export class GitHubProcess extends Context.Service<
  GitHubProcess,
  { attempt(args: readonly string[], cwd: string, options?: GitHubRun): Effect.Effect<CommandResult> }
>()('shinsa/engine/github/process/GitHubProcess') {
  static readonly layer = Layer.effect(
    GitHubProcess,
    Effect.gen(function* () {
      const shell = yield* Shell;
      const notStarted = (stderr: string, code: number): CommandResult => ({
        ok: false,
        code,
        stdout: '',
        stderr,
        timedOut: false,
      });

      const attempt = Effect.fn('GitHubProcess.attempt')(function* (
        args: readonly string[],
        cwd: string,
        options: GitHubRun = {}
      ) {
        if (options.signal?.aborted) return notStarted(CANCELLED_BEFORE_START, CANCELLED_EXIT_CODE);
        return yield* shell
          .run({
            argv: ['gh', ...args],
            cwd,
            input: options.input,
            timeout: GITHUB_TIMEOUT,
            cancel: resolveCancel(options.signal),
          })
          .pipe(
            Effect.catchTag('CommandNotFound', (missing) =>
              Effect.succeed(notStarted(missing.message, NOT_STARTED_EXIT_CODE))
            )
          );
      });

      return GitHubProcess.of({ attempt });
    })
  );

  static readonly layerTest = (answer: GitHubAnswer) =>
    Layer.succeed(GitHubProcess)(
      GitHubProcess.of({
        attempt: (args, _cwd, options = {}) => Effect.sync(() => answer(args, options.input)),
      })
    );
}
