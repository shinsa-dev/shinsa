import { Context, Effect, FileSystem, Option, Schema } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { describeError } from '../../log/redact.ts';
import { selectErrnoCode } from '../../shell/errno.ts';
import { LockFileFailed, type LockHolder, LockHolderJson } from './schema.ts';

export const HeldLocks = Context.Reference<Set<string>>('shinsa/engine/instance/lock/HeldLocks', {
  defaultValue: () => new Set<string>(),
});

export const parseLockHolder = Schema.decodeUnknownOption(LockHolderJson);

const encodeLockHolder = Schema.encodeEffect(LockHolderJson);

function toFileFailure(error: PlatformError) {
  return new LockFileFailed({ code: selectErrnoCode(error.reason.cause), message: describeError(error) });
}

export const readLockText = Effect.fn('ServeLock.readText')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(path).pipe(
    Effect.map(Option.some),
    Effect.mapError(toFileFailure),
    Effect.catchIf(
      (failure) => failure.code === 'ENOENT',
      () => Effect.succeedNone
    ),
    Effect.orDie
  );
});

export const readLockHolder = Effect.fn('ServeLock.readHolder')(function* (path: string) {
  return Option.flatMap(yield* readLockText(path), parseLockHolder);
});

const writeDraft = Effect.fn('ServeLock.writeDraft')(function* (path: string, holder: LockHolder) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* encodeLockHolder(holder).pipe(Effect.orDie);
  const draft = `${path}.${process.pid}.${Bun.randomUUIDv7()}`;
  yield* fs.writeFileString(draft, text).pipe(Effect.mapError(toFileFailure), Effect.orDie);
  return draft;
});

export const writeLockExclusive = Effect.fn('ServeLock.writeExclusive')(function* (
  path: string,
  holder: LockHolder
) {
  const fs = yield* FileSystem.FileSystem;
  return yield* Effect.acquireUseRelease(
    writeDraft(path, holder),
    (draft) =>
      fs.link(draft, path).pipe(
        Effect.as(true),
        Effect.mapError(toFileFailure),
        Effect.catchIf(
          (failure) => failure.code === 'EEXIST',
          () => Effect.succeed(false)
        ),
        Effect.orDie
      ),
    (draft) => fs.remove(draft, { force: true }).pipe(Effect.mapError(toFileFailure), Effect.orDie)
  );
});

export const replaceLock = Effect.fn('ServeLock.replace')(function* (path: string, holder: LockHolder) {
  const fs = yield* FileSystem.FileSystem;
  const draft = yield* writeDraft(path, holder);
  yield* fs.rename(draft, path).pipe(Effect.mapError(toFileFailure), Effect.orDie);
});

export const removeLock = Effect.fn('ServeLock.remove')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(path, { force: true }).pipe(Effect.mapError(toFileFailure), Effect.orDie);
});
