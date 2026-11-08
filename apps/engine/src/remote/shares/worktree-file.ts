import { join } from 'node:path';
import { Effect, FileSystem, Option } from 'effect';
import { isInside } from '../../files/paths.ts';
import { describeError } from '../../log/index.ts';
import { ShareCodeUnreadable } from './schema.ts';

export const readWorktreeFile = Effect.fn('Shares.readWorktreeFile')(function* (
  worktree: string,
  path: string
) {
  const fs = yield* FileSystem.FileSystem;
  const unreadable = (error: unknown) => new ShareCodeUnreadable({ message: describeError(error) });
  const root = yield* fs.realPath(worktree).pipe(Effect.mapError(unreadable));
  const full = join(root, path);
  const link = yield* Effect.option(fs.readLink(full));
  if (Option.isSome(link)) return link.value;
  const real = yield* fs.realPath(full).pipe(Effect.mapError(unreadable));
  if (real === root || !isInside(root, real))
    return yield* new ShareCodeUnreadable({ message: `${path} leads outside the working copy.` });
  return yield* fs.readFileString(real).pipe(Effect.mapError(unreadable));
});
