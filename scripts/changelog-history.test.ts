import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { resolveBuildChangelog } from './changelog-history.ts';

let root = '';

afterEach(() => {
  $.env(process.env);
  rmSync(root, { recursive: true, force: true });
});

async function createRepository() {
  root = mkdtempSync(join(tmpdir(), 'shinsa-history-'));
  writeFileSync(join(root, 'gitconfig'), '[user]\n\tname = Shinsa\n\temail = shinsa@example.com\n');
  $.env({ ...process.env, GIT_CONFIG_GLOBAL: join(root, 'gitconfig') });
  const repo = join(root, 'repo');
  mkdirSync(join(repo, '.changes'), { recursive: true });
  await $`git init -q`.cwd(repo);
  return repo;
}

async function recordEntry(repo: string, slug: string, kind: string, text: string) {
  writeFileSync(join(repo, `.changes/${slug}.md`), `---\nkind: ${kind}\n---\n${text}\n`);
  await $`git add -A`.cwd(repo);
  await $`git ${'commit'} -q -m ${slug}`.cwd(repo);
}

describe('resolveBuildChangelog', () => {
  it('files each entry under the release that first shipped it and leaves internal ones out', async () => {
    const repo = await createRepository();
    await recordEntry(repo, 'faster-diffs', 'fixed', 'Large diffs open without freezing.');
    await $`git tag v1.0.0`.cwd(repo);
    await recordEntry(repo, 'whats-new', 'added', 'A What’s new button shows what changed.');
    await recordEntry(repo, 'tidy-runner', 'internal', 'The runner is simpler inside.');
    await $`git tag v1.1.0-canary.1`.cwd(repo);

    const changelog = await resolveBuildChangelog(repo, '1.1.0');
    expect(changelog.releases.map((release) => release.version)).toEqual(['1.1.0', '1.0.0']);
    expect(changelog.releases.map((release) => release.changes.map((change) => change.slug))).toEqual([
      ['whats-new'],
      ['faster-diffs'],
    ]);
    expect(changelog.releases[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps every entry unreleased in a development build', async () => {
    const repo = await createRepository();
    await recordEntry(repo, 'faster-diffs', 'fixed', 'Large diffs open without freezing.');
    await $`git tag v1.0.0`.cwd(repo);

    const changelog = await resolveBuildChangelog(repo, '0.0.0');
    expect(changelog.releases).toEqual([
      {
        version: null,
        date: null,
        changes: [{ slug: 'faster-diffs', kind: 'fixed', text: 'Large diffs open without freezing.' }],
      },
    ]);
  });

  it('refuses to build with an invalid entry', async () => {
    const repo = await createRepository();
    await recordEntry(repo, 'broken', 'shiny', 'Something.');
    expect(resolveBuildChangelog(repo, '1.0.0')).rejects.toThrow('.changes/broken.md');
  });
});
