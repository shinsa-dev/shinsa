import { appendFileSync } from 'node:fs';
import { $ } from 'bun';
import { describeCanaryDecision, resolveCanaryDecision, selectLastCanaryTag } from './release-version.ts';

const head = Bun.env.RELEASE_SHA || 'HEAD';
const tags = (await $`git tag --list ${'v*'}`.text())
  .split('\n')
  .map((tag) => tag.trim())
  .filter(Boolean);
const base = selectLastCanaryTag(tags);

async function listChangedFiles(from: string | null) {
  if (!from) return [];
  return (await $`git diff --name-only ${from} ${head}`.text())
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
}

async function isReleased(from: string | null) {
  if (!from) return false;
  return (await $`git merge-base --is-ancestor ${head} ${from}`.nothrow().quiet()).exitCode === 0;
}

const changed = await listChangedFiles(base);
const decision = resolveCanaryDecision(base, changed, await isReleased(base));
const summary = describeCanaryDecision(decision);

if (Bun.env.GITHUB_OUTPUT) appendFileSync(Bun.env.GITHUB_OUTPUT, `build=${decision.build}\n`);
if (Bun.env.GITHUB_STEP_SUMMARY) appendFileSync(Bun.env.GITHUB_STEP_SUMMARY, `${summary}\n\n`);
process.stdout.write(`${summary}\n`);
