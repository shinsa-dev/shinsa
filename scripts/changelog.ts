import { $ } from 'bun';
import { listChangeFiles } from './changelog-files.ts';
import { MISSING_ENTRY_MESSAGE, needsChangelogEntry, resolveChangelogCheck } from './changelog-rules.ts';

const root = (await $`git rev-parse --show-toplevel`.text()).trim();
const [command, ...rest] = Bun.argv.slice(2);
const baseIndex = rest.indexOf('--base');
const base = baseIndex === -1 ? null : rest[baseIndex + 1];

if (command !== 'check' || base === undefined) {
  process.stderr.write('Usage: bun scripts/changelog.ts check [--base <ref>]\n');
  process.exit(2);
}

function listPaths(output: string) {
  return output
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean);
}

async function listChanged(filter: string) {
  const untracked = listPaths(await $`git ls-files --others --exclude-standard`.cwd(root).text());
  const tracked = listPaths(
    await $`git diff --name-only --diff-filter=${filter} --merge-base ${base}`.cwd(root).text()
  );
  return [...tracked, ...untracked];
}

const check = resolveChangelogCheck(listChangeFiles(root));
const errors = check.ok ? [] : [...check.errors];
if (base !== null && needsChangelogEntry(await listChanged('ACMRD'), await listChanged('A')))
  errors.push(MISSING_ENTRY_MESSAGE);

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exit(1);
}
const count = check.ok ? check.entries.length : 0;
process.stdout.write(
  `Checked ${count} changelog ${count === 1 ? 'entry' : 'entries'}: every one is valid.\n`
);
