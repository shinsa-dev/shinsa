import { linkSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { Context, Effect, Option, Predicate, Schema } from 'effect';
import { describeError } from '../../log/redact.ts';
import { LockFileFailed, LockHolder } from './schema.ts';

export const HeldLocks = Context.Reference<Set<string>>('shinsa/engine/instance/lock/HeldLocks', {
  defaultValue: () => new Set<string>(),
});

export const parseLockHolder = Schema.decodeUnknownOption(Schema.fromJsonString(LockHolder));

function toFileFailure(error: unknown) {
  const code = Predicate.hasProperty(error, 'code') && Predicate.isString(error.code) ? error.code : null;
  return new LockFileFailed({ code, message: describeError(error) });
}

export function readLockText(path: string) {
  return Effect.try({ try: () => Option.some(readFileSync(path, 'utf8')), catch: toFileFailure }).pipe(
    Effect.catchIf(
      (failure) => failure.code === 'ENOENT',
      () => Effect.succeedNone
    ),
    Effect.orDie
  );
}

export function readLockHolder(path: string) {
  return readLockText(path).pipe(Effect.map(Option.flatMap(parseLockHolder)));
}

function writeDraft(path: string, text: string) {
  return Effect.sync(() => {
    const draft = `${path}.${process.pid}.${Bun.randomUUIDv7()}`;
    writeFileSync(draft, text);
    return draft;
  });
}

export function writeLockExclusive(path: string, holder: LockHolder) {
  return Effect.acquireUseRelease(
    writeDraft(path, JSON.stringify(holder)),
    (draft) =>
      Effect.try({ try: () => linkSync(draft, path), catch: toFileFailure }).pipe(
        Effect.as(true),
        Effect.catchIf(
          (failure) => failure.code === 'EEXIST',
          () => Effect.succeed(false)
        ),
        Effect.orDie
      ),
    (draft) => Effect.sync(() => rmSync(draft, { force: true }))
  );
}

export function replaceLock(path: string, holder: LockHolder) {
  return writeDraft(path, JSON.stringify(holder)).pipe(
    Effect.flatMap((draft) => Effect.sync(() => renameSync(draft, path)))
  );
}

export function removeLock(path: string) {
  return Effect.sync(() => rmSync(path, { force: true }));
}
