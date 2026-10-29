import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readOriginRemote } from '../../src/repos/index.ts';
import { createTempDir, git } from '../helpers/index.ts';

async function createRepo(root: string, name: string, ...remotes: [string, string][]) {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  await git(path, 'init', '-q', '-b', 'main');
  for (const [remote, url] of remotes) await git(path, 'remote', 'add', remote, url);
  return path;
}

describe('readOriginRemote', () => {
  test('reads the origin from the repository’s config, whatever remote comes first', async () => {
    const root = createTempDir();
    const ssh = await createRepo(
      root,
      'ssh',
      ['upstream', 'https://github.com/other/ssh.git'],
      ['origin', 'git@github.com:acme/ssh.git']
    );
    const https = await createRepo(root, 'https', ['origin', 'https://token@github.com/acme/https.git']);
    expect(readOriginRemote(ssh)).toBe('github.com/acme/ssh');
    expect(readOriginRemote(https)).toBe('github.com/acme/https');
  });

  test('follows a worktree’s .git file to the main repository’s config', async () => {
    const root = createTempDir();
    const main = await createRepo(root, 'main', ['origin', 'git@github.com:acme/main.git']);
    await git(main, 'commit', '-q', '--allow-empty', '-m', 'chore: start');
    await git(main, 'worktree', 'add', '-q', join(root, 'linked'));
    expect(readOriginRemote(join(root, 'linked'))).toBe('github.com/acme/main');
  });

  test('a .git file pointing at a folder of its own reads that folder’s config', async () => {
    const root = createTempDir();
    const store = await createRepo(root, 'store', ['origin', 'git@github.com:acme/store.git']);
    const checkout = join(root, 'checkout');
    mkdirSync(checkout);
    writeFileSync(join(checkout, '.git'), `gitdir: ../store/.git\n`);
    expect(readOriginRemote(checkout)).toBe('github.com/acme/store');
    expect(readOriginRemote(store)).toBe('github.com/acme/store');
  });

  test('is null with no origin, no .git, an unreadable .git file or a folder that is not there', async () => {
    const root = createTempDir();
    const bare = await createRepo(root, 'bare', ['upstream', 'git@github.com:acme/bare.git']);
    const plain = join(root, 'plain');
    mkdirSync(plain);
    const broken = join(root, 'broken');
    mkdirSync(broken);
    writeFileSync(join(broken, '.git'), 'nothing here\n');
    const empty = join(root, 'empty');
    mkdirSync(join(empty, '.git'), { recursive: true });
    expect(readOriginRemote(bare)).toBeNull();
    expect(readOriginRemote(plain)).toBeNull();
    expect(readOriginRemote(broken)).toBeNull();
    expect(readOriginRemote(empty)).toBeNull();
    expect(readOriginRemote(join(root, 'nowhere'))).toBeNull();
  });
});
