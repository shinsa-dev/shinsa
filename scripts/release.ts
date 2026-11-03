import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { CHANGES_DIRECTORY } from '../packages/core/src/changelog/index.ts';
import { listChangeFiles } from './changelog-files.ts';
import {
  listReleaseEntries,
  resolveChangelogCheck,
  selectEntrySlug,
  serializeReleaseBody,
} from './changelog-rules.ts';
import {
  describeReleaseChannel,
  parseReleaseOptions,
  resolveChangesSinceTag,
  resolveReleasePlan,
} from './release-version.ts';

const { channel, bump } = parseReleaseOptions(Bun.env.RELEASE_CHANNEL, Bun.env.RELEASE_BUMP);
const root = (await $`git rev-parse --show-toplevel`.text()).trim();
const tags = (await $`git tag --list ${'v*'}`.text())
  .split('\n')
  .map((tag) => tag.trim())
  .filter(Boolean);
const plan = resolveReleasePlan({ tags, channel, bump });

const check = resolveChangelogCheck(listChangeFiles(root));
if (!check.ok) throw new Error(`The changelog has invalid entries:\n${check.errors.join('\n')}`);

async function listReleasedSlugs(tag: string | null) {
  if (!tag) return [];
  return (await $`git ls-tree --name-only ${tag} ${`${CHANGES_DIRECTORY}/`}`.cwd(root).text())
    .split('\n')
    .map((path) => selectEntrySlug(path.trim()))
    .filter((slug) => slug !== null);
}

const entries = listReleaseEntries(check.entries, await listReleasedSlugs(resolveChangesSinceTag(plan)));
const notesFile = join(Bun.env.RUNNER_TEMP ?? tmpdir(), 'release-notes.md');
writeFileSync(notesFile, serializeReleaseBody(describeReleaseChannel(plan), entries));

const outputs = [
  `version=${plan.version}`,
  `tag=${plan.tag}`,
  `prerelease=${plan.prerelease}`,
  `channel=${plan.channel}`,
  `notes_start_tag=${plan.notesStartTag ?? ''}`,
  `notes_file=${notesFile}`,
];
const summary = `Releasing **Shinsa ${plan.version}** on the ${plan.channel} channel (the last stable release is ${plan.lastStable ?? 'none'}), with ${entries.length} changelog ${entries.length === 1 ? 'entry' : 'entries'}.`;

if (Bun.env.GITHUB_OUTPUT) appendFileSync(Bun.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
if (Bun.env.GITHUB_STEP_SUMMARY) appendFileSync(Bun.env.GITHUB_STEP_SUMMARY, `${summary}\n\n`);
process.stdout.write(`${summary}\n${outputs.join('\n')}\n`);
