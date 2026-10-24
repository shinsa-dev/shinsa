import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { verifySetup } from '../../src/repos/index.ts';
import { createGitRepo, createTempDir, git, writeFiles } from '../helpers/index.ts';

const BUILD = { defaultBranch: true, checks: true };

describe('verifySetup', () => {
  test('a repository with its default branch and check scripts is ready', async () => {
    const { repo } = await createGitRepo({
      remote: false,
      files: { 'package.json': JSON.stringify({ scripts: { test: 'bun test' } }) },
    });
    expect(await verifySetup(repo, BUILD)).toEqual([]);
  });

  test('a missing folder or one that is not a git repository stops everything else', async () => {
    const { repo } = await createGitRepo({ remote: false });
    const gone = join(createTempDir(), 'gone');
    expect(await verifySetup({ ...repo, path: gone }, BUILD)).toEqual([
      { kind: 'repository', detail: `The folder ${gone} no longer exists.` },
    ]);
    const plain = createTempDir();
    expect(await verifySetup({ ...repo, path: plain }, BUILD)).toEqual([
      { kind: 'repository', detail: `${plain} is not a git repository.` },
    ]);
  });

  test('a default branch that is missing locally is fetched from origin before it counts as missing', async () => {
    const { repo, path } = await createGitRepo({ files: { 'package.json': '{"scripts":{"lint":"x"}}' } });
    await git(path, 'checkout', '-q', '-b', 'work');
    await git(path, 'branch', '-q', '-D', 'main');
    await git(path, 'update-ref', '-d', 'refs/remotes/origin/main');
    expect(await verifySetup(repo, BUILD)).toEqual([]);
    expect(await verifySetup({ ...repo, defaultBranch: 'trunk' }, BUILD)).toEqual([
      { kind: 'default_branch', detail: 'The default branch “trunk” is not in the repository or on origin.' },
    ]);
    expect(await verifySetup({ ...repo, defaultBranch: 'trunk', remote: null }, BUILD)).toEqual([
      { kind: 'default_branch', detail: 'The default branch “trunk” is not in the repository.' },
    ]);
  });

  test('a default branch that git would read as an option is a problem, and never reaches git', async () => {
    const { repo, path, root } = await createGitRepo({
      files: { 'package.json': '{"scripts":{"lint":"x"}}' },
    });
    const marker = join(root, 'ran');
    await git(path, 'update-ref', '-d', 'refs/remotes/origin/main');
    const defaultBranch = `--upload-pack=touch ${marker};git-upload-pack`;
    expect(await verifySetup({ ...repo, defaultBranch }, BUILD)).toEqual([
      { kind: 'default_branch', detail: `"${defaultBranch}" is not a branch name Shinsa will pass to git.` },
    ]);
    expect(existsSync(marker)).toBe(false);
  });

  test('missing checks are a problem unless set, waived or out of scope, and a broken manifest says why', async () => {
    const { repo, path } = await createGitRepo({ remote: false });
    expect(await verifySetup(repo, BUILD)).toEqual([
      {
        kind: 'check_commands',
        detail:
          'No check commands are set, and package.json has no lint, check-types, typecheck or test script to run.',
      },
    ]);
    expect(await verifySetup({ ...repo, checkCommands: ['make test'] }, BUILD)).toEqual([]);
    expect(await verifySetup({ ...repo, checksWaived: true }, BUILD)).toEqual([]);
    expect(await verifySetup(repo, { defaultBranch: false, checks: false })).toEqual([]);
    writeFiles(path, { 'package.json': '{' });
    const [problem] = await verifySetup(repo, BUILD);
    expect(problem).toMatchObject({ kind: 'check_commands' });
    expect(problem?.detail).toContain('is not valid JSON');
  });
});
