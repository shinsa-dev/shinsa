import { Effect, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { type ScriptCommandOptions, ScriptStepFailed } from './schema.ts';

export const runScriptCommand = Effect.fn('DesktopScript.run')(function* (
  argv: readonly [string, ...string[]],
  options: ScriptCommandOptions = {}
) {
  const [program, ...args] = argv;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const failed = (detail: string) => new ScriptStepFailed({ message: `${argv.join(' ')} failed: ${detail}` });
  const [code, stderr] = yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(program, args, {
          cwd: options.cwd,
          env: options.env,
          extendEnv: true,
          stdout: 'ignore',
        })
      );
      return yield* Effect.all([handle.exitCode, Stream.mkString(Stream.decodeText(handle.stderr))], {
        concurrency: 'unbounded',
      });
    })
  ).pipe(Effect.mapError((error) => failed(error.message)));
  if (code !== 0) return yield* failed(stderr);
});
