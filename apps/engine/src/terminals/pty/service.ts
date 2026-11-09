import { Context, Deferred, Effect, Exit, Layer, Schedule, Scope } from 'effect';
import { constNull } from 'effect/Function';
import { Shell } from '../../shell/service.ts';
import {
  FOREGROUND_TIMEOUT,
  GROUP_POLL_SCHEDULE,
  HANG_UP_GRACE,
  NO_FREE_PORT,
  PORT_RELEASE_SCHEDULE,
  PORT_RETRY,
  type PortListener,
  PortTaken,
  PortUnavailable,
  type TerminalProcess,
  type TerminalSpawnOptions,
} from '../schema.ts';
import { spawnTerminal } from './spawn.ts';

export class TerminalPty extends Context.Service<
  TerminalPty,
  {
    spawn(command: readonly string[], options: TerminalSpawnOptions): Effect.Effect<TerminalProcess>;
    readForeground(pid: number): Effect.Effect<string | null>;
    pickPort(
      preferred: number | null,
      taken: ReadonlySet<number>,
      listen: PortListener
    ): Effect.Effect<number, PortUnavailable>;
  }
>()('shinsa/engine/terminals/pty/TerminalPty') {
  static readonly layer = Layer.effect(
    TerminalPty,
    Effect.gen(function* () {
      const shell = yield* Shell;
      const context = yield* Effect.context<never>();
      const runFork = Effect.runForkWith(context);

      const runPromise = Effect.runPromiseWith(context);

      const signalGroup = (pid: number, name: NodeJS.Signals | 0) =>
        Effect.try(() => process.kill(-pid, name)).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false)
        );

      const waitForGroup = (pid: number) =>
        signalGroup(pid, 0).pipe(
          Effect.repeat({
            schedule: GROUP_POLL_SCHEDULE.pipe(Schedule.upTo({ duration: HANG_UP_GRACE })),
            until: (alive) => !alive,
          })
        );

      const hangUpGroup = Effect.fn('TerminalPty.hangUp')(function* (child: Bun.Subprocess) {
        yield* signalGroup(child.pid, 'SIGHUP');
        yield* Effect.sync(() => child.terminal?.close());
        if (!(yield* waitForGroup(child.pid))) return;
        yield* signalGroup(child.pid, 'SIGKILL');
        yield* waitForGroup(child.pid);
      });

      const spawn = Effect.fn('TerminalPty.spawn')(function* (
        command: readonly string[],
        options: TerminalSpawnOptions
      ) {
        const scope = yield* Scope.make();
        const ended = yield* Deferred.make<void>();
        const child = yield* Effect.acquireRelease(
          Effect.sync(() => spawnTerminal(command, options)),
          (spawned) => hangUpGroup(spawned).pipe(Effect.ensuring(Deferred.done(ended, Exit.void)))
        ).pipe(Scope.provide(scope));
        const close = () => runFork(Scope.close(scope, Exit.void));
        const exited = runPromise(
          Effect.promise(() => child.exited).pipe(
            Effect.tap(() => Scope.close(scope, Exit.void)),
            Effect.tap(() => Deferred.await(ended))
          )
        );
        const { terminal } = child;
        return {
          pid: child.pid,
          write: (data) => {
            if (!terminal?.closed) terminal?.write(data);
          },
          resize: (cols, rows) => {
            if (!terminal?.closed) terminal?.resize(cols, rows);
          },
          hangUp: () => {
            close();
          },
          exited,
        } satisfies TerminalProcess;
      });

      const readField = Effect.fn('TerminalPty.readField')(function* (field: string, pid: number) {
        const result = yield* shell
          .run({ argv: ['ps', '-o', `${field}=`, '-p', String(pid)], cwd: '/', timeout: FOREGROUND_TIMEOUT })
          .pipe(Effect.orElseSucceed(constNull));
        return result?.stdout.trim() ?? '';
      });

      const readForeground = Effect.fn('TerminalPty.readForeground')(function* (pid: number) {
        const group = Number(yield* readField('tpgid', pid));
        if (!Number.isInteger(group) || group <= 0 || group === pid) return null;
        const command = yield* readField('comm', group);
        return command.split('/').pop()?.replace(/^-/, '') || 'a program';
      });

      const pickPort = Effect.fn('TerminalPty.pickPort')(function* (
        preferred: number | null,
        taken: ReadonlySet<number>,
        listen: PortListener
      ) {
        const pickAny = Effect.suspend(() => {
          const port = listen(0);
          return port !== null && !taken.has(port)
            ? Effect.succeed(port)
            : Effect.fail(new PortTaken({ port }));
        }).pipe(
          Effect.retry(PORT_RETRY),
          Effect.catchTag('PortTaken', () => Effect.fail(new PortUnavailable({ message: NO_FREE_PORT })))
        );
        if (preferred === null || taken.has(preferred)) return yield* pickAny;
        return yield* Effect.suspend(() =>
          listen(preferred) === preferred
            ? Effect.succeed(preferred)
            : Effect.fail(new PortTaken({ port: preferred }))
        ).pipe(
          Effect.retry(PORT_RELEASE_SCHEDULE),
          Effect.catchTag('PortTaken', () => pickAny)
        );
      });

      return TerminalPty.of({ spawn, readForeground, pickPort });
    })
  );
}
