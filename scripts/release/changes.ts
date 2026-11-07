import { Effect } from 'effect';
import { CHANGES_DIRECTORY } from '../../packages/core/src/changelog/index.ts';
import { listChangeFiles } from '../changelog-files.ts';
import { resolveChangelogCheck, selectEntrySlug } from '../changelog-rules.ts';
import { Command } from '../kit/command/index.ts';
import { ChangelogInvalid } from './schema.ts';

export const listValidEntries = Effect.fn('listValidEntries')(function* (root: string) {
  const check = resolveChangelogCheck(yield* listChangeFiles(root));
  if (check.ok) return check.entries;
  return yield* new ChangelogInvalid({
    errors: check.errors,
    message: `The changelog has invalid entries:\n${check.errors.join('\n')}`,
  });
});

export const listReleasedSlugs = Effect.fn('listReleasedSlugs')(function* (root: string, tag: string) {
  const command = yield* Command;
  const paths = yield* command.lines(['git', 'ls-tree', '--name-only', tag, `${CHANGES_DIRECTORY}/`], {
    cwd: root,
  });
  return paths.map(selectEntrySlug).filter((slug) => slug !== null);
});

export const listTags = Effect.fn('listTags')(function* (root: string) {
  const command = yield* Command;
  return yield* command.lines(['git', 'tag', '--list', 'v*'], { cwd: root });
});
