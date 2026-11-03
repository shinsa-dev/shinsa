import { Context, Effect, Exit, Layer, Scope } from 'effect';
import { constNull } from 'effect/Function';
import { Shell } from '../../shell/service.ts';
import {
  FOREGROUND_TIMEOUT,
  HANG_UP_GRACE,
  NO_FREE_PORT,
  PORT_RETRY,
  type PortListener,
  PortTaken,
  PortUnavailable,
  type TerminalProcess,
  type TerminalSpawnOptions,
} from '../schema.ts';

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

      const signal = (child: Bun.Subprocess, name: NodeJS.Signals) =>
        Effect.sync(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill(name);
        });

      const hangUpChild = Effect.fn('TerminalPty.hangUp')(function* (child: Bun.Subprocess) {
        yield* signal(child, 'SIGHUP');
        yield* Effect.sync(() => child.terminal?.close());
        yield* Effect.raceFirst(
          Effect.promise(() => child.exited),
          Effect.sleep(HANG_UP_GRACE)
        );
        yield* signal(child, 'SIGKILL');
      });

      const spawn = Effect.fn('TerminalPty.spawn')(function* (
        command: readonly string[],
        options: TerminalSpawnOptions
      ) {
        const scope = yield* Scope.make();
        const child = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.spawn([...command], {
              cwd: options.cwd,
              env: options.env,
              terminal: {
                cols: options.cols,
                rows: options.rows,
                name: 'xterm-256color',
                data: (_terminal, data) => options.onData(data),
              },
            })
          ),
          hangUpChild
        ).pipe(Scope.provide(scope));
        const close = () => runFork(Scope.close(scope, Exit.void));
        runFork(
          Effect.andThen(
            Effect.promise(() => child.exited),
            Scope.close(scope, Exit.void)
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
          exited: child.exited,
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
        if (preferred !== null && !taken.has(preferred) && listen(preferred) === preferred) return preferred;
        return yield* Effect.suspend(() => {
          const port = listen(0);
          return port !== null && !taken.has(port)
            ? Effect.succeed(port)
            : Effect.fail(new PortTaken({ port }));
        }).pipe(
          Effect.retry(PORT_RETRY),
          Effect.catchTag('PortTaken', () => Effect.fail(new PortUnavailable({ message: NO_FREE_PORT })))
        );
      });

      return TerminalPty.of({ spawn, readForeground, pickPort });
    })
  );
}
