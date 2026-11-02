import { existsSync, realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { Context, Duration, Effect, Layer, Schedule } from 'effect';
import { Shell } from '../../shell/service.ts';
import {
  LIST_TIMEOUT,
  LSOF_COMMAND,
  PS_COMMAND,
  STOP_GRACE,
  STOP_POLL_SCHEDULE,
  type StopOptions,
} from './schema.ts';
import { listWorkingFolderPids, resolveStopTargets } from './targets.ts';

export class LeftoverProcesses extends Context.Service<
  LeftoverProcesses,
  {
    list(path: string): Effect.Effect<number[]>;
    stop(path: string, options?: StopOptions): Effect.Effect<number[]>;
  }
>()('shinsa/engine/git/leftovers/LeftoverProcesses') {
  static readonly layer = Layer.effect(
    LeftoverProcesses,
    Effect.gen(function* () {
      const shell = yield* Shell;

      const runListing = (argv: readonly [string, ...string[]]) =>
        shell
          .run({ argv, cwd: sep, timeout: LIST_TIMEOUT })
          .pipe(Effect.catchTag('CommandNotFound', () => Effect.succeed(null)));

      const signal = (pid: number, name: NodeJS.Signals | 0) =>
        Effect.try(() => process.kill(pid, name)).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false)
        );

      const list = Effect.fn('LeftoverProcesses.list')(function* (path: string) {
        const listable = yield* Effect.sync(() => existsSync(path) && Bun.which('lsof') !== null);
        if (!listable) return [];
        const root = yield* Effect.sync(() => realpathSync(path));
        const listed = yield* runListing(LSOF_COMMAND);
        return listWorkingFolderPids(listed?.stdout ?? '', root);
      });

      const listAlive = (pids: readonly number[]) => Effect.filter(pids, (pid) => signal(pid, 0));

      const waitForExit = (pids: readonly number[], grace: Duration.Duration) =>
        listAlive(pids).pipe(
          Effect.repeat({
            schedule: STOP_POLL_SCHEDULE.pipe(Schedule.upTo({ duration: grace })),
            until: (left) => left.length === 0,
          })
        );

      const stop = Effect.fn('LeftoverProcesses.stop')(function* (path: string, options: StopOptions = {}) {
        const found = yield* list(path);
        if (found.length === 0) return [];
        const table = yield* runListing(PS_COMMAND);
        if (!table?.ok) return [];
        const targets = resolveStopTargets(
          found,
          table.stdout,
          options.owner ?? process.pid,
          options.spare ?? []
        );
        if (targets.length === 0) return [];
        yield* Effect.forEach(targets, (pid) => signal(pid, 'SIGTERM'), { discard: true });
        const grace = options.graceMs === undefined ? STOP_GRACE : Duration.millis(options.graceMs);
        const stubborn = yield* waitForExit(targets, grace);
        yield* Effect.forEach(stubborn, (pid) => signal(pid, 'SIGKILL'), { discard: true });
        yield* Effect.logInfo('[Git] Stopped processes left in a worktree').pipe(
          Effect.annotateLogs({ path, count: targets.length, killed: stubborn.length })
        );
        return targets;
      });

      return LeftoverProcesses.of({ list, stop });
    })
  );
}
