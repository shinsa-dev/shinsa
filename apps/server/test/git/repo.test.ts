import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { inspectRepo, resolveRepoRoot } from '../../src/git/index.ts';
import { normalizeRemote } from '../../src/git/repo.ts';
import { createGitRepo, createTempDir, git } from '../helpers/index.ts';

describe('normalizeRemote', () => {
  test('ssh, https and credentialed remotes become host/owner/name', () => {
    expect(normalizeRemote('git@github.com:acme/app.git')).toBe('github.com/acme/app');
    expect(normalizeRemote('https://github.com/acme/app.git')).toBe('github.com/acme/app');
    expect(normalizeRemote('https://x-access-token:secret@github.com/acme/app')).toBe('github.com/acme/app');
    expect(normalizeRemote('ssh://git@github.com/acme/app.git')).toBe('github.com/acme/app');
  });
});

describe('inspectRepo', () => {
  test('reads the root, the default branch from origin and the remote', async () => {
    const { path, origin } = await createGitRepo();
    expect(await inspectRepo(join(path))).toEqual({
      path: await git(path, 'rev-parse', '--show-toplevel'),
      name: 'app',
      defaultBranch: 'main',
      remote: origin.replace(/\.git$/, ''),
    });
  });

  test('without a remote it takes main, then master, then the current branch', async () => {
    const { path } = await createGitRepo({ remote: false });
    expect((await inspectRepo(path)).defaultBranch).toBe('main');
    expect((await inspectRepo(path)).remote).toBeNull();
    await git(path, 'branch', '-m', 'main', 'master');
    expect((await inspectRepo(path)).defaultBranch).toBe('master');
    await git(path, 'branch', '-m', 'master', 'trunk');
    expect((await inspectRepo(path)).defaultBranch).toBe('trunk');
  });
});

describe('resolveRepoRoot', () => {
  test('finds the repository a directory belongs to, or nothing', async () => {
    const { path } = await createGitRepo({ files: { 'src/a.ts': '' } });
    expect(await resolveRepoRoot(join(path, 'src'))).toBe(await git(path, 'rev-parse', '--show-toplevel'));
    expect(await resolveRepoRoot(createTempDir())).toBeNull();
    expect(await resolveRepoRoot(join(createTempDir(), 'missing'))).toBeNull();
  });
});
