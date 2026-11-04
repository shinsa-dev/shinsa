import { Effect } from 'effect';
import { resolveChangelog, resolvePublicChangelog } from '../packages/core/src/changelog/index.ts';
import { DEVELOPMENT_VERSION } from '../packages/core/src/protocol/schema.ts';
import { listReleasedChanges } from './changelog-rules.ts';
import { Command } from './kit/command/index.ts';
import { listChannelTagsBefore } from './release-version.ts';
import { listReleasedSlugs, listTags, listValidEntries } from './release/changes.ts';

export const resolveBuildChangelog = Effect.fn('resolveBuildChangelog')(function* (
  root: string,
  version: string
) {
  const command = yield* Command;
  const entries = yield* listValidEntries(root);
  const resolveDate = Effect.fn('resolveBuildChangelog.date')(function* (ref: string) {
    return (yield* command.text(['git', 'log', '-1', '--format=%cs', ref], { cwd: root })) || null;
  });
  const resolveRelease = Effect.fn('resolveBuildChangelog.release')(function* (tag: string) {
    return {
      version: tag.replace(/^v/, ''),
      date: yield* resolveDate(tag),
      slugs: yield* listReleasedSlugs(root, tag),
    };
  });
  const tags = listChannelTagsBefore(yield* listTags(root), version);
  const releases = yield* Effect.forEach(tags, resolveRelease, { concurrency: 8 });
  const current =
    version === DEVELOPMENT_VERSION
      ? { version: null, date: null }
      : { version, date: yield* resolveDate('HEAD') };
  return resolvePublicChangelog(resolveChangelog(listReleasedChanges(entries, releases, current)));
});
