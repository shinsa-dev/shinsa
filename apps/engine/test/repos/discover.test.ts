import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Duration } from 'effect';
import { discoverRoots } from '../../src/repos/index.ts';
import { createTempDir } from '../helpers/index.ts';

function createRepo(path: string, gitFile = false) {
  mkdirSync(path, { recursive: true });
  if (gitFile) writeFileSync(join(path, '.git'), 'gitdir: elsewhere\n');
  else mkdirSync(join(path, '.git'));
}

function createHome() {
  const home = createTempDir();
  for (const name of ['app', 'site', 'api']) createRepo(join(home, 'Developer', 'Projects', name));
  createRepo(join(home, 'Developer', 'Projects', 'app', 'packages', 'inner'));
  createRepo(join(home, 'code', 'tool'), true);
  createRepo(join(home, 'node_modules', 'dep'));
  createRepo(join(home, 'Library', 'thing'));
  createRepo(join(home, '.cache', 'hidden'));
  createRepo(join(home, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'too-deep'));
  writeFileSync(join(home, 'notes.txt'), '');
  return home;
}

describe('discoverRoots', () => {
  test('ranks the folders that hold repositories by how many they hold, skipping caches and hidden folders', async () => {
    const home = createHome();
    expect(await discoverRoots(home)).toEqual({
      candidates: [
        { path: join(home, 'Developer', 'Projects'), repoCount: 3, repos: ['api', 'app', 'site'] },
        { path: join(home, 'code'), repoCount: 1, repos: ['tool'] },
      ],
      truncated: false,
      refused: [],
    });
  });

  test('stops at the depth and folder limits and says so', async () => {
    const home = createHome();
    expect((await discoverRoots(home, { maxDepth: 1 })).candidates).toEqual([]);
    expect(await discoverRoots(home, { maxDirs: 2 })).toEqual({
      candidates: [],
      truncated: true,
      refused: [],
    });
    expect(await discoverRoots(home, { budget: Duration.zero })).toEqual({
      candidates: [],
      truncated: true,
      refused: [],
    });
    expect((await discoverRoots(join(home, 'missing'))).candidates).toEqual([]);
  });

  test('keeps a sample of names for a folder with many repositories', async () => {
    const home = createTempDir();
    for (let index = 0; index < 10; index += 1) createRepo(join(home, 'src', `repo-${index}`));
    const [candidate] = (await discoverRoots(home)).candidates;
    expect(candidate?.repoCount).toBe(10);
    expect(candidate?.repos).toHaveLength(8);
  });

  test('scans Desktop, Documents, Downloads and the media folders like any other', async () => {
    const home = createTempDir();
    for (const org of ['Github', 'Superwall', 'Maple']) createRepo(join(home, 'Documents', org, 'app'));
    createRepo(join(home, 'Downloads', 'zip'));
    createRepo(join(home, 'Desktop', 'sketch'));
    createRepo(join(home, 'Pictures', 'site'));
    createRepo(join(home, 'Developer', 'go', 'build', 'target', 'vendor', 'shop'));
    expect((await discoverRoots(home)).candidates.map((candidate) => candidate.path)).toEqual([
      join(home, 'Desktop'),
      join(home, 'Developer', 'go', 'build', 'target', 'vendor'),
      join(home, 'Documents', 'Github'),
      join(home, 'Documents', 'Maple'),
      join(home, 'Documents', 'Superwall'),
      join(home, 'Downloads'),
      join(home, 'Pictures'),
    ]);
  });

  test('finds a repository eight levels below home and skips package bundles', async () => {
    const home = createTempDir();
    createRepo(join(home, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'deep'));
    createRepo(join(home, 'Pictures', 'Photos Library.photoslibrary', 'inside'));
    createRepo(join(home, 'Applications', 'Tool.app', 'inside'));
    createRepo(join(home, 'Projects', 'App.xcodeproj', 'inside'));
    expect((await discoverRoots(home)).candidates).toEqual([
      { path: join(home, 'a', 'b', 'c', 'd', 'e', 'f', 'g'), repoCount: 1, repos: ['deep'] },
    ]);
  });

  test('reports the folders it may not read and keeps scanning the rest', async () => {
    const home = createTempDir();
    createRepo(join(home, 'Developer', 'shop'));
    createRepo(join(home, 'Documents', 'Github', 'app'));
    createRepo(join(home, 'Desktop', 'sketch'));
    const locked = [join(home, 'Desktop'), join(home, 'Documents')];
    for (const folder of locked) chmodSync(folder, 0o000);
    try {
      expect(await discoverRoots(home)).toEqual({
        candidates: [{ path: join(home, 'Developer'), repoCount: 1, repos: ['shop'] }],
        truncated: false,
        refused: locked,
      });
    } finally {
      for (const folder of locked) chmodSync(folder, 0o755);
    }
  });
});
