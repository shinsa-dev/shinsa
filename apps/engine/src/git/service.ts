import { CODE_LIMITS } from '@shinsa/core';
import { Context, Duration, Effect, Exit, Layer, Ref, Scope, Stream } from 'effect';
import { constant, constFalse } from 'effect/Function';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { awaitAbort, resolveCancel } from '../shell/abort.ts';
import { describeFailure } from '../shell/failure.ts';
import { stopProcessGroup } from '../shell/processes.ts';
import {
  CANCELLED_BEFORE_START,
  CANCELLED_EXIT_CODE,
  COMMAND_TIMEOUT,
  type CommandResult,
  GROUP_LEFT_RUNNING_SIGNAL,
  KILLED_EXIT_CODE,
  NOT_STARTED_EXIT_CODE,
  type StopReason,
} from '../shell/schema.ts';
import { Shell } from '../shell/service.ts';
import {
  CANCELLED_READ,
  CANCELLED_READ_MESSAGE,
  GitFailed,
  type GitRead,
  type GitReadRequest,
  type GitRun,
  LOCK_RETRY,
  LOCKED,
  NEWLINE,
  NOT_STARTED_READ,
  READ_ENV,
} from './schema.ts';

export class Git extends Context.Service<
  Git,
  {
    attempt(args: readonly string[], cwd: string, options?: GitRun): Effect.Effect<CommandResult>;
    run(args: readonly string[], cwd: string, options?: GitRun): Effect.Effect<string, GitFailed>;
    read(args: readonly string[], cwd: string, request?: GitReadRequest): Effect.Effect<GitRead>;
  }
>()('shinsa/engine/git/Git') {
  static readonly layer = Layer.effect(
    Git,
    Effect.gen(function* () {
      const shell = yield* Shell;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const gitScope = yield* Effect.scope;

      const attempt = Effect.fn('Git.attempt')(function* (
        args: readonly string[],
        cwd: string,
        options: GitRun = {}
      ) {
        if (options.signal?.aborted) {
          return {
            ok: false,
            code: CANCELLED_EXIT_CODE,
            stdout: '',
            stderr: CANCELLED_BEFORE_START,
            timedOut: false,
          } satisfies CommandResult;
        }
        return yield* shell
          .run({
            argv: ['git', ...args],
            cwd,
            input: options.input,
            env: options.env,
            timeout: options.timeout === undefined ? COMMAND_TIMEOUT : options.timeout,
            cancel: resolveCancel(options.signal),
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
          );
      });

      const run = Effect.fn('Git.run')(function* (
        args: readonly string[],
        cwd: string,
        options: GitRun = {}
      ) {
        const once = Effect.flatMap(attempt(args, cwd, options), (result) =>
          result.ok
            ? Effect.succeed(result.stdout)
            : Effect.fail(
                new GitFailed({
                  message: describeFailure(['git', ...args], result),
                  retryable: LOCKED.test(result.stderr),
                })
              )
        );
        return yield* Effect.retry(once, LOCK_RETRY);
      });

      const failedRead = (stderr: string, code = NOT_STARTED_READ): GitRead => ({
        ok: false,
        code,
        bytes: new Uint8Array(),
        stderr,
        timedOut: false,
        truncated: false,
      });

      const read = Effect.fn('Git.read')(function* (
        args: readonly string[],
        cwd: string,
        request: GitReadRequest = {}
      ) {
        if (request.signal?.aborted) return failedRead(CANCELLED_READ_MESSAGE, CANCELLED_READ);
        const limit = request.maxBytes ?? Number.POSITIVE_INFINITY;
        const lineLimit = request.maxLines ?? Number.POSITIVE_INFINITY;
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const processScope = yield* Scope.make();
            yield* Effect.addFinalizer((exit) =>
              Exit.isSuccess(exit)
                ? Effect.asVoid(Effect.forkIn(Scope.close(processScope, exit), gitScope))
                : Scope.close(processScope, exit)
            );
            const spawned = yield* spawner
              .spawn(
                ChildProcess.make('git', ['-c', 'core.quotePath=false', ...args], {
                  cwd,
                  env: {
                    ...READ_ENV,
                    ...request.env,
                    GIT_LITERAL_PATHSPECS: request.literal === false ? '0' : '1',
                  },
                  extendEnv: true,
                  stdin: 'ignore',
                  detached: true,
                  killSignal: GROUP_LEFT_RUNNING_SIGNAL,
                })
              )
              .pipe(Scope.provide(processScope), Effect.result);
            if (spawned._tag === 'Failure') return failedRead(spawned.failure.message);
            const handle = spawned.success;
            yield* Effect.addFinalizer(() =>
              Effect.flatMap(Effect.orElseSucceed(handle.isRunning, constFalse), (running) =>
                running ? stopProcessGroup(handle.pid) : Effect.void
              )
            );
            const stopped = yield* Ref.make<StopReason | null>(null);
            const timeout = Effect.as(
              Effect.sleep(request.timeout ?? Duration.millis(CODE_LIMITS.readMs)),
              'timeout' as const
            );
            const cancel = request.signal
              ? Effect.as(awaitAbort(request.signal), 'cancel' as const)
              : Effect.never;
            yield* Effect.forkScoped(
              Effect.raceFirst(timeout, cancel).pipe(
                Effect.flatMap((reason) => Ref.set(stopped, reason)),
                Effect.andThen(stopProcessGroup(handle.pid))
              )
            );
            const chunks: Uint8Array[] = [];
            const counted = { length: 0, lines: 0, truncated: false };
            const take = Effect.fnUntraced(function* (chunk: Uint8Array) {
              chunks.push(chunk);
              counted.length += chunk.length;
              if (request.onData) yield* request.onData(chunk);
              if (lineLimit !== Number.POSITIVE_INFINITY) {
                for (let at = chunk.indexOf(NEWLINE); at >= 0; at = chunk.indexOf(NEWLINE, at + 1)) {
                  counted.lines += 1;
                }
              }
              counted.truncated = counted.length > limit || counted.lines > lineLimit;
              return !counted.truncated;
            });
            const output = handle.stdout.pipe(
              Stream.runForEachWhile(take),
              Effect.ignore,
              Effect.tap(() => (counted.truncated ? stopProcessGroup(handle.pid) : Effect.void))
            );
            const stderr = handle.stderr.pipe(
              Stream.decodeText(),
              Stream.mkString,
              Effect.orElseSucceed(constant(''))
            );
            const [, text] = yield* Effect.all([output, stderr], { concurrency: 'unbounded' });
            const code = yield* Effect.orElseSucceed(handle.exitCode, constant(KILLED_EXIT_CODE));
            const timedOut = (yield* Ref.get(stopped)) === 'timeout';
            const length = Math.min(counted.length, limit);
            const bytes = new Uint8Array(length);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk.subarray(0, length - offset), offset);
              offset += Math.min(chunk.length, length - offset);
            }
            return {
              ok: (code === 0 || counted.truncated) && !timedOut,
              code,
              bytes,
              stderr: text.trim(),
              timedOut,
              truncated: counted.truncated,
            };
          })
        );
      });

      return Git.of({ attempt, run, read });
    })
  );
}
