import { appendFileSync } from 'node:fs';
import { $ } from 'bun';
import { listStaleCanaries } from './release-version.ts';

const repository = Bun.env.GITHUB_REPOSITORY ?? 'shinsa-dev/shinsa';
const releases =
  (await $`gh release list --repo ${repository} --limit 200 --json tagName,isDraft`.json()) as {
    tagName: string;
    isDraft: boolean;
  }[];
const published = [
  ...new Set(releases.filter((release) => !release.isDraft).map((release) => release.tagName)),
];
const stale = listStaleCanaries(published);
for (const tag of stale) await $`gh release delete ${tag} --repo ${repository} --cleanup-tag --yes`;

const summary =
  stale.length > 0
    ? `Removed ${stale.length} older canary releases and their tags: ${stale.join(', ')}.`
    : 'No older canary releases to remove.';
if (Bun.env.GITHUB_STEP_SUMMARY) appendFileSync(Bun.env.GITHUB_STEP_SUMMARY, `**Canaries:** ${summary}\n\n`);
process.stdout.write(`${summary}\n`);
