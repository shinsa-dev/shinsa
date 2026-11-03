import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareSetup, verifySetup } from '../../src/repos/index.ts';
import { runCommandOrThrow } from '../../src/shell/index.ts';
import { createGitRepo, createTempDir, git } from '../helpers/index.ts';

const BUILD = { defaultBranch: true };

describe('verifySetup', () => {
  test('a repository with its default branch is ready, with or without check commands', async () => {
    const { repo } = await createGitRepo({ remote: false });
    expect(await verifySetup(repo, BUILD)).toEqual([]);
    expect(await verifySetup({ ...repo, defaultBranch: 'trunk' }, { defaultBranch: false })).toEqual([]);
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
});

async function createEmptyRepo(origin: 'none' | 'empty' | 'busy' = 'none') {
  const { repo } = await createGitRepo({ remote: false });
  const root = createTempDir();
  const path = join(root, 'fresh');
  mkdirSync(path);
  await git(path, 'init', '-q', '-b', 'master');
  const bare = join(root, 'origin.git');
  if (origin !== 'none') {
    await runCommandOrThrow(['git', 'init', '--bare', '-q', bare], root);
    await git(path, 'remote', 'add', 'origin', bare);
  }
  if (origin === 'busy') {
    await git(repo.path, 'push', '-q', bare, 'main:refs/heads/other');
  }
  return { repo: { ...repo, path, remote: origin === 'none' ? null : 'github.com/acme/fresh' }, path, bare };
}

async function readLog(path: string, ref = 'HEAD') {
  return (await git(path, 'log', '--format=%s', ref)).trim();
}

describe('prepareSetup', () => {
  test('a repository with no commits gets an empty first commit on its default branch, and then verifies', async () => {
    const { repo, path } = await createEmptyRepo();
    writeFileSync(join(path, 'notes.md'), 'kept\n');
    expect(await prepareSetup(repo)).toEqual({ branch: 'main', initialized: false, pushed: false });
    expect(await readLog(path, 'main')).toBe('chore: start the repository');
    expect((await git(path, 'status', '--porcelain')).trim()).toBe('?? notes.md');
    expect(await verifySetup(repo, BUILD)).toEqual([]);
    expect(await prepareSetup(repo)).toBeNull();
  });

  test('an empty folder becomes a repository on the default branch', async () => {
    const { repo } = await createGitRepo({ remote: false });
    const path = createTempDir();
    expect(await prepareSetup({ ...repo, path, defaultBranch: 'trunk' })).toEqual({
      branch: 'trunk',
      initialized: true,
      pushed: false,
    });
    expect(await readLog(path, 'trunk')).toBe('chore: start the repository');
  });

  test('the first commit is pushed to an origin with no branches', async () => {
    const { repo, path, bare } = await createEmptyRepo('empty');
    expect(await prepareSetup(repo)).toEqual({ branch: 'main', initialized: false, pushed: true });
    expect(await readLog(bare, 'main')).toBe('chore: start the repository');
    expect(await readLog(path, 'origin/main')).toBe('chore: start the repository');
  });

  test('a push the origin refuses still leaves the local first commit', async () => {
    const { repo, path, bare } = await createEmptyRepo('empty');
    writeFileSync(join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    expect(await prepareSetup(repo)).toEqual({ branch: 'main', initialized: false, pushed: false });
    expect(await readLog(path, 'main')).toBe('chore: start the repository');
  });

  test('nothing is touched where work could be lost or the origin already has history', async () => {
    const { repo: started } = await createGitRepo();
    expect(await prepareSetup(started)).toBeNull();

    const busy = await createEmptyRepo('busy');
    expect(await prepareSetup(busy.repo)).toBeNull();
    expect(await git(busy.path, 'for-each-ref')).toBe('');

    const unreachable = await createEmptyRepo('empty');
    await git(unreachable.path, 'remote', 'set-url', 'origin', join(unreachable.path, 'missing.git'));
    expect(await prepareSetup(unreachable.repo)).toBeNull();

    const files = createTempDir();
    writeFileSync(join(files, 'index.ts'), 'x\n');
    expect(await prepareSetup({ ...started, path: files })).toBeNull();
    expect(existsSync(join(files, '.git'))).toBe(false);

    expect(await prepareSetup({ ...started, path: join(files, 'gone') })).toBeNull();

    const option = await createEmptyRepo();
    expect(await prepareSetup({ ...option.repo, defaultBranch: '--force' })).toBeNull();
  });

  test('a step git refuses leaves the repository as it was', async () => {
    const locked = await createEmptyRepo();
    writeFileSync(join(locked.path, '.git', 'HEAD.lock'), '');
    expect(await prepareSetup(locked.repo)).toBeNull();

    const nameless = await createEmptyRepo();
    await git(nameless.path, 'config', 'user.name', '');
    await git(nameless.path, 'config', 'user.useConfigOnly', 'true');
    expect(await prepareSetup(nameless.repo)).toBeNull();
    expect(await git(nameless.path, 'for-each-ref')).toBe('');

    const { repo } = await createGitRepo({ remote: false });
    const sealed = createTempDir();
    chmodSync(sealed, 0o555);
    expect(await prepareSetup({ ...repo, path: sealed })).toBeNull();
    chmodSync(sealed, 0o755);
  });
});
