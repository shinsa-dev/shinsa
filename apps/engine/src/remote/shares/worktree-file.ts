import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { isInside } from '../../files/paths.ts';
import { describeError } from '../../log/index.ts';
import { ShareCodeUnreadable } from './schema.ts';

export const readWorktreeFile = Effect.fn('Shares.readWorktreeFile')(function* (
  worktree: string,
  path: string
) {
  const located = yield* Effect.try({
    try: () => {
      const root = realpathSync(worktree);
      const full = join(root, path);
      if (lstatSync(full).isSymbolicLink()) return { link: readlinkSync(full), root, real: full };
      return { link: null, root, real: realpathSync(full) };
    },
    catch: (error) => new ShareCodeUnreadable({ message: describeError(error) }),
  });
  if (located.link !== null) return located.link;
  if (located.real === located.root || !isInside(located.root, located.real))
    return yield* new ShareCodeUnreadable({ message: `${path} leads outside the working copy.` });
  return yield* Effect.tryPromise({
    try: () => Bun.file(located.real).text(),
    catch: (error) => new ShareCodeUnreadable({ message: describeError(error) }),
  });
});
