import { appendFileSync } from 'node:fs';
import { $ } from 'bun';
import { describeReleaseChannel, parseReleaseOptions, resolveReleasePlan } from './release-version.ts';

const { channel, bump } = parseReleaseOptions(Bun.env.RELEASE_CHANNEL, Bun.env.RELEASE_BUMP);
const tags = (await $`git tag --list ${'v*'}`.text())
  .split('\n')
  .map((tag) => tag.trim())
  .filter(Boolean);
const plan = resolveReleasePlan({ tags, channel, bump });
const notes = describeReleaseChannel(plan);

const outputs = [
  `version=${plan.version}`,
  `tag=${plan.tag}`,
  `prerelease=${plan.prerelease}`,
  `channel=${plan.channel}`,
  `notes_start_tag=${plan.notesStartTag ?? ''}`,
  `notes=${notes}`,
];
const summary = `Releasing **Shinsa ${plan.version}** on the ${plan.channel} channel (the last stable release is ${plan.lastStable ?? 'none'}).`;

if (Bun.env.GITHUB_OUTPUT) appendFileSync(Bun.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
if (Bun.env.GITHUB_STEP_SUMMARY) appendFileSync(Bun.env.GITHUB_STEP_SUMMARY, `${summary}\n\n`);
process.stdout.write(`${summary}\n${outputs.join('\n')}\n`);
