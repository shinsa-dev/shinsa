import { Context, Effect, Layer, type PlatformError, Ref, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { listDescendants, stopProcess, stopProcessGroup } from './processes.ts';
import {
  CommandNotFound,
  type CommandRequest,
  type CommandResult,
  KILLED_EXIT_CODE,
  PROCESS_TABLE_COMMAND,
  PROCESS_TABLE_TIMEOUT,
  QUIET_ENV,
  type StopReason,
} from './schema.ts';

export class Shell extends Context.Service<
  Shell,
  {
    run(request: CommandRequest): Effect.Effect<CommandResult, CommandNotFound>;
    stopTree(pid: number): Effect.Effect<void>;
  }
>()('shinsa/engine/shell/Shell') {
  static readonly layer = Layer.effect(
    Shell,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const readOutput = (
        stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
        onLine: CommandRequest['onLine']
      ) => {
        const text = stream.pipe(Stream.decodeText());
        if (!onLine) return Effect.orDie(Stream.mkString(text));
        return Effect.gen(function* () {
          const output = yield* Ref.make('');
          yield* text.pipe(
            Stream.tap((part) => Ref.update(output, (all) => all + part)),
            Stream.splitLines,
            Stream.filter((line) => line.trim() !== ''),
            Stream.runForEach(onLine),
            Effect.orDie
          );
          return yield* Ref.get(output);
        });
      };

      const run = Effect.fn('Shell.run')(function* (request: CommandRequest) {
        const [program, ...args] = request.argv;
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner
              .spawn(
                ChildProcess.make(program, args, {
                  cwd: request.cwd,
                  env: { ...QUIET_ENV, ...request.env },
                  extendEnv: true,
                  stdin:
                    request.input === undefined
                      ? 'ignore'
                      : Stream.make(new TextEncoder().encode(request.input)),
                  detached: true,
                })
              )
              .pipe(
                Effect.mapError((error) => new CommandNotFound({ command: program, message: error.message }))
              );
            if (request.onSpawn) yield* request.onSpawn(handle.pid);
            const stopped = yield* Ref.make<StopReason | null>(null);
            const timeout =
              request.timeout === null
                ? Effect.never
                : Effect.as(Effect.sleep(request.timeout), 'timeout' as const);
            const cancel = request.cancel ? Effect.as(request.cancel, 'cancel' as const) : Effect.never;
            yield* Effect.forkScoped(
              Effect.raceFirst(timeout, cancel).pipe(
                Effect.flatMap((reason) => Ref.set(stopped, reason)),
                Effect.andThen(stopProcessGroup(handle.pid))
              )
            );
            const exited = handle.exitCode.pipe(
              Effect.catch(() => Effect.succeed(KILLED_EXIT_CODE)),
              Effect.tap(() =>
                Effect.flatMap(Ref.get(stopped), (reason) =>
                  reason === null ? Effect.void : stopProcessGroup(handle.pid)
                )
              )
            );
            const [stdout, stderr, code] = yield* Effect.all(
              [readOutput(handle.stdout, request.onLine), readOutput(handle.stderr, request.onLine), exited],
              { concurrency: 'unbounded' }
            );
            if (code === 0) yield* Effect.ignore(handle.unref);
            const timedOut = (yield* Ref.get(stopped)) === 'timeout';
            return {
              ok: code === 0 && !timedOut,
              code,
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              timedOut,
            };
          })
        );
      });

      const stopTree = Effect.fn('Shell.stopTree')(function* (pid: number) {
        const table = yield* run({
          argv: PROCESS_TABLE_COMMAND,
          cwd: process.cwd(),
          timeout: PROCESS_TABLE_TIMEOUT,
        }).pipe(Effect.catchTag('CommandNotFound', () => Effect.succeed(null)));
        const descendants = table?.ok ? listDescendants(table.stdout, pid) : [];
        yield* stopProcessGroup(pid);
        yield* Effect.forEach(descendants, stopProcess, { discard: true });
      });

      return { run, stopTree };
    })
  );
}
