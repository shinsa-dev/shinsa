import { hostname } from 'node:os';
import { join } from 'node:path';
import { Duration, Effect, FileSystem, Option, Schedule } from 'effect';
import { constant } from 'effect/Function';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { isProcessAlive } from '../../instance/lock/liveness.ts';
import {
  BrowserUnavailable,
  HOLDER_POLL_SCHEDULE,
  HEADLESS_FLAG,
  KILL_GRACE,
  PROFILE_IN_USE_MESSAGE,
  type ProfileHolder,
  type ProfileLock,
  SINGLETON_FILES,
  SINGLETON_LOCK,
  SINGLETON_LOCK_TARGET,
} from './schema.ts';

export function parseProfileLock(target: string): Option.Option<ProfileLock> {
  const match = SINGLETON_LOCK_TARGET.exec(target.trim());
  if (!match?.[1] || !match[2]) return Option.none();
  return Option.some({ host: match[1], pid: Number(match[2]) });
}

export function isOpenedOn(commandLine: string, folder: string) {
  const flag = `--user-data-dir=${folder}`;
  const line = commandLine.trim();
  return line.endsWith(flag) || line.includes(`${flag} `);
}

export function isHeadless(commandLine: string) {
  return commandLine.split(/\s+/).includes(HEADLESS_FLAG);
}

function resolveProfileInUseMessage(pid: number | null) {
  if (pid === null) return PROFILE_IN_USE_MESSAGE;
  return PROFILE_IN_USE_MESSAGE.replace('Another program', `Another program (process ${pid})`);
}

export const profileInUse = (pid: number | null) =>
  new BrowserUnavailable({ reason: 'profile_in_use', message: resolveProfileInUseMessage(pid) });

const readCommandLine = (pid: number) =>
  Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
    spawner.string(ChildProcess.make('ps', ['-ww', '-o', 'args=', '-p', String(pid)]))
  ).pipe(Effect.orElseSucceed(constant('')));

const readLiveCommandLine = (pid: number) => {
  if (!isProcessAlive(pid)) return Effect.succeed('');
  return readCommandLine(pid);
};

export const resolveProfileHolder = Effect.fn('BrowserHost.resolveProfileHolder')(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem;
  const target = yield* fs.readLink(join(folder, SINGLETON_LOCK)).pipe(Effect.option);
  const lock = Option.flatMap(target, parseProfileLock);
  if (Option.isNone(lock)) return { kind: 'none' } satisfies ProfileHolder;
  const { host, pid } = lock.value;
  const elsewhere = host !== hostname();
  if (!elsewhere && (pid === process.pid || !isProcessAlive(pid)))
    return { kind: 'none' } satisfies ProfileHolder;
  const commandLine = yield* readLiveCommandLine(pid);
  if (isOpenedOn(commandLine, folder)) {
    return { kind: 'ours', pid, headless: isHeadless(commandLine) } satisfies ProfileHolder;
  }
  if (elsewhere) return { kind: 'stale' } satisfies ProfileHolder;
  return { kind: 'foreign', pid } satisfies ProfileHolder;
});

const signal = (pid: number, name: NodeJS.Signals) =>
  Effect.ignore(Effect.try(() => process.kill(pid, name)));

const waitForExit = (pid: number, grace: Duration.Input) =>
  Effect.sync(() => isProcessAlive(pid)).pipe(
    Effect.repeat({
      schedule: HOLDER_POLL_SCHEDULE.pipe(Schedule.upTo({ duration: Duration.fromInputUnsafe(grace) })),
      until: (alive) => !alive,
    })
  );

export const stopProfileHolder = Effect.fn('BrowserHost.stopProfileHolder')(function* (
  pid: number,
  grace: Duration.Input
) {
  yield* signal(pid, 'SIGTERM');
  if (!(yield* waitForExit(pid, grace))) return;
  yield* signal(pid, 'SIGKILL');
  if (yield* waitForExit(pid, KILL_GRACE)) return yield* profileInUse(pid);
});

export const reclaimProfile = Effect.fn('BrowserHost.reclaimProfile')(function* (
  folder: string,
  grace: Duration.Input
) {
  const holder = yield* resolveProfileHolder(folder);
  if (holder.kind === 'none') return;
  if (holder.kind === 'stale') return yield* removeStaleLock(folder);
  if (holder.kind === 'foreign') return yield* profileInUse(holder.pid);
  yield* stopOrphan(folder, holder.pid, grace);
  const left = yield* resolveProfileHolder(folder);
  if (left.kind === 'stale') yield* removeStaleLock(folder);
});

const removeStaleLock = Effect.fn('BrowserHost.removeStaleLock')(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.forEach(
    SINGLETON_FILES,
    (name) => Effect.ignore(fs.remove(join(folder, name), { force: true })),
    {
      discard: true,
    }
  );
  yield* Effect.logWarning('[Browser] Removed a profile lock Chrome left under another host name').pipe(
    Effect.annotateLogs({ profile: folder })
  );
});

const stopOrphan = Effect.fn('BrowserHost.stopOrphan')(function* (
  folder: string,
  pid: number,
  grace: Duration.Input
) {
  yield* stopProfileHolder(pid, grace);
  yield* Effect.logWarning('[Browser] Stopped a Chrome an earlier Shinsa left running').pipe(
    Effect.annotateLogs({ pid, profile: folder })
  );
});

const sweepProfile = Effect.fn('BrowserHost.sweepProfile')(function* (folder: string, grace: Duration.Input) {
  const holder = yield* resolveProfileHolder(folder);
  if (holder.kind !== 'ours' || !holder.headless) return;
  yield* stopOrphan(folder, holder.pid, grace);
});

export const sweepOrphans = Effect.fn('BrowserHost.sweepOrphans')(function* (
  root: string,
  grace: Duration.Input
) {
  const fs = yield* FileSystem.FileSystem;
  const names = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(constant([])));
  yield* Effect.forEach(names, (name) => Effect.ignore(sweepProfile(join(root, name), grace)), {
    concurrency: 'unbounded',
    discard: true,
  });
});
