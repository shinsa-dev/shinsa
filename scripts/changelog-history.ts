import { $ } from 'bun';
import {
  CHANGES_DIRECTORY,
  resolveChangelog,
  resolvePublicChangelog,
} from '../packages/core/src/changelog/index.ts';
import { DEVELOPMENT_VERSION } from '../packages/core/src/protocol/schema.ts';
import { listChangeFiles } from './changelog-files.ts';
import { listReleasedChanges, resolveChangelogCheck, selectEntrySlug } from './changelog-rules.ts';
import { listChannelTagsBefore } from './release-version.ts';

function listLines(output: string) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function resolveBuildChangelog(root: string, version: string) {
  const check = resolveChangelogCheck(listChangeFiles(root));
  if (!check.ok) throw new Error(`The changelog has invalid entries:\n${check.errors.join('\n')}`);

  const tags = listChannelTagsBefore(listLines(await $`git tag --list ${'v*'}`.cwd(root).text()), version);
  const releases = await Promise.all(
    tags.map(async (tag) => ({
      version: tag.replace(/^v/, ''),
      date: (await $`git log -1 --format=%cs ${tag}`.cwd(root).text()).trim() || null,
      slugs: listLines(await $`git ls-tree --name-only ${tag} ${`${CHANGES_DIRECTORY}/`}`.cwd(root).text())
        .map(selectEntrySlug)
        .filter((slug) => slug !== null),
    }))
  );
  const current = { version: null as string | null, date: null as string | null };
  if (version !== DEVELOPMENT_VERSION) {
    current.version = version;
    current.date = (await $`git log -1 --format=%cs HEAD`.cwd(root).text()).trim() || null;
  }
  return resolvePublicChangelog(resolveChangelog(listReleasedChanges(check.entries, releases, current)));
}
