import { type Duration, Effect, Option, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type { ProcessResult } from './schema.ts';

export const runProcess = Effect.fn('Desktop.runProcess')(function* (
  program: string,
  args: ReadonlyArray<string>,
  options: { readonly timeout: Duration.Duration; readonly env?: Record<string, string> }
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const finished = Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(program, [...args], { env: options.env, extendEnv: true, stdin: 'ignore' })
      );
      const [stdout, stderr, code] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
          handle.exitCode,
        ],
        { concurrency: 'unbounded' }
      );
      const result: ProcessResult = { ok: code === 0, stdout, stderr };
      return result;
    })
  );
  return yield* finished.pipe(
    Effect.timeoutOption(options.timeout),
    Effect.orElseSucceed(() => Option.none<ProcessResult>())
  );
});
