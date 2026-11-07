import { join } from 'node:path';
import { Clock, Context, Effect, FileSystem, Layer, Option, Ref, type Scope } from 'effect';
import {
  HeldLocks,
  parseLockHolder,
  readLockHolder,
  readLockText,
  removeLock,
  replaceLock,
  writeLockExclusive,
} from './file.ts';
import { isProcessAlive, resolveBootedAt } from './liveness.ts';
import {
  BOOT_TOLERANCE_MS,
  LOCK_FILE,
  type LockAddress,
  LockBusy,
  LockContended,
  type LockHolder,
  type LockOptions,
  type LockOwner,
  ServerRunning,
  TAKEOVER_SCHEDULE,
} from './schema.ts';

export class ServeLock extends Context.Service<
  ServeLock,
  {
    readonly path: string;
    readonly holder: Effect.Effect<LockHolder>;
    update(address: LockAddress): Effect.Effect<void>;
  }
>()('shinsa/engine/instance/lock/ServeLock') {
  static acquire(
    dataDir: string,
    owner: LockOwner,
    options: LockOptions = {}
  ): Effect.Effect<ServeLock['Service'], ServerRunning | LockContended, Scope.Scope | FileSystem.FileSystem> {
    return Effect.gen(function* () {
      const path = join(dataDir, LOCK_FILE);
      const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);
      const held = yield* HeldLocks;
      const isAlive = options.isAlive ?? isProcessAlive;
      const bootedAt = options.bootedAt ?? resolveBootedAt(yield* Clock.currentTimeMillis);
      const claim: LockHolder = { ...owner, bootedAt };

      const isLive = (holder: LockHolder) => {
        if (Math.abs(holder.bootedAt - bootedAt) > BOOT_TOLERANCE_MS) return false;
        if (holder.pid === process.pid) return held.has(path);
        return isAlive(holder.pid);
      };

      const attempt = Effect.gen(function* () {
        if (yield* writeLockExclusive(path, claim)) return yield* Ref.make(claim);
        const text = yield* readLockText(path);
        const stale = Option.flatMap(text, parseLockHolder);
        if (Option.isSome(stale) && isLive(stale.value)) {
          return yield* new ServerRunning({ dataDir, holder: stale.value });
        }
        const again = yield* readLockText(path);
        if (Option.isSome(text) && Option.isSome(again) && again.value === text.value) {
          yield* Effect.logWarning('[Serve] Took over the lock a stopped Shinsa left behind').pipe(
            Effect.annotateLogs({ path, pid: Option.getOrNull(Option.map(stale, (holder) => holder.pid)) })
          );
          yield* removeLock(path);
        }
        return yield* new LockBusy({ dataDir });
      });

      const take = attempt.pipe(
        Effect.retry({ schedule: TAKEOVER_SCHEDULE, while: (error) => error._tag === 'LockBusy' }),
        Effect.catchTag('LockBusy', () => Effect.fail(new LockContended({ dataDir }))),
        Effect.tap(() => Effect.sync(() => held.add(path)))
      );

      const release = Effect.fn('ServeLock.release')(function* (holder: Ref.Ref<LockHolder>) {
        yield* Effect.sync(() => held.delete(path));
        const mine = yield* Ref.get(holder);
        const current = yield* readLockHolder(path);
        if (Option.isNone(current)) return;
        if (current.value.pid !== mine.pid || current.value.startedAt !== mine.startedAt) return;
        yield* removeLock(path);
      });

      const holder = yield* Effect.acquireRelease(take, release);

      return ServeLock.of({
        path,
        holder: Ref.get(holder),
        update: (address) =>
          Ref.updateAndGet(holder, (current) => ({ ...current, ...address })).pipe(
            Effect.flatMap((next) => withFiles(replaceLock(path, next)))
          ),
      });
    });
  }

  static layer(dataDir: string, owner: LockOwner, options: LockOptions = {}) {
    return Layer.effect(ServeLock, ServeLock.acquire(dataDir, owner, options));
  }
}
