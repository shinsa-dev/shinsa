import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDiscoverer, discoverRoots } from '../../src/repos/index.ts';
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
  createRepo(join(home, 'a', 'b', 'c', 'd', 'too-deep'));
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
    });
  });

  test('stops at the depth and folder limits and says so', async () => {
    const home = createHome();
    expect((await discoverRoots(home, { maxDepth: 1 })).candidates).toEqual([]);
    expect(await discoverRoots(home, { maxDirs: 2 })).toEqual({ candidates: [], truncated: true });
    expect((await discoverRoots(join(home, 'missing'))).candidates).toEqual([]);
  });

  test('keeps a sample of names for a folder with many repositories', async () => {
    const home = createTempDir();
    for (let index = 0; index < 10; index += 1) createRepo(join(home, 'src', `repo-${index}`));
    const [candidate] = (await discoverRoots(home)).candidates;
    expect(candidate?.repoCount).toBe(10);
    expect(candidate?.repos).toHaveLength(8);
  });

  test('the app’s engine leaves Desktop, Documents and Downloads alone, which macOS keeps private', async () => {
    const home = createTempDir();
    createRepo(join(home, 'Documents', 'Projects', 'notes'));
    createRepo(join(home, 'Downloads', 'zip'));
    createRepo(join(home, 'Desktop', 'sketch'));
    createRepo(join(home, 'Developer', 'shop'));
    expect((await createDiscoverer(true)(home)).candidates.map((candidate) => candidate.path)).toEqual([
      join(home, 'Developer'),
    ]);
    expect((await createDiscoverer(false)(home)).candidates).toHaveLength(4);
  });
});
