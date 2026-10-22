import { describe, expect, test } from 'bun:test';
import { mkdirSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  listCandidateRepos,
  listLocalRepos,
  resolveAreaName,
  resolveContainingRepo,
  resolveGithubLogin,
  upsertRepo,
} from '../../src/repos/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createGitRepo, createTempDir, git, overrideEnv } from '../helpers/index.ts';
import { createStubEngine } from '../helpers/state.ts';

function createRoot() {
  const root = createTempDir();
  for (const [name, mtime] of [
    ['older', 1_000],
    ['newer', 2_000],
  ] as const) {
    mkdirSync(join(root, name, '.git'), { recursive: true });
    utimesSync(join(root, name), mtime, mtime);
  }
  mkdirSync(join(root, 'not-a-repo'));
  writeFileSync(join(root, 'file.txt'), '');
  symlinkSync(join(root, 'missing'), join(root, 'broken'));
  return root;
}

describe('listLocalRepos', () => {
  test('finds git repositories one level down, newest first, once each, skipping files and missing roots', () => {
    const root = createRoot();
    const repos = listLocalRepos([root, root, join(root, 'file.txt'), join(root, 'nowhere')]);
    expect(repos.map((repo) => repo.name)).toEqual(['newer', 'older']);
    expect(repos[0]?.path).toBe(realpathSync(join(root, 'newer')));
  });
});

describe('area names', () => {
  test('the user’s own repositories are Personal, others are named after their owner', async () => {
    const login = () => Promise.resolve('christo');
    expect(await resolveAreaName(null, login)).toBe('Local');
    expect(await resolveAreaName('github.com/Christo/app', login)).toBe('Personal');
    expect(await resolveAreaName('github.com/superwall-me/paywall', login)).toBe('Superwall Me');
  });

  test('the GitHub login is read once from gh', async () => {
    const restore = overrideEnv({ FAKE_GH_LOGIN: 'Christo' });
    try {
      expect(await resolveGithubLogin()).toBe('christo');
      expect(await resolveGithubLogin()).toBe('christo');
    } finally {
      restore();
    }
  });
});

describe('upsertRepo', () => {
  test('registers a repository the first time and returns it after', async () => {
    const { path } = await createGitRepo();
    const engine = new Engine(new EventLog(join(createTempDir(), 'db.sqlite')));
    const login = () => Promise.resolve(null);
    const first = await upsertRepo(engine, join(path), login);
    const again = await upsertRepo(engine, path, login);
    expect(again.id).toBe(first.id);
    expect(Object.keys(engine.state.repos)).toHaveLength(1);
  });

  test('a registration that does not land is an error', async () => {
    const { path } = await createGitRepo({ remote: false });
    const { engine } = createStubEngine();
    expect(upsertRepo(engine, path, () => Promise.resolve(null))).rejects.toThrow('Could not register app.');
  });
});

describe('resolveContainingRepo', () => {
  test('matches the repository a path is inside', () => {
    const repos = [{ path: '/code/app', name: 'app', touchedAt: 0 }];
    expect(resolveContainingRepo(null, repos)).toBeNull();
    expect(resolveContainingRepo('/code/app/src', repos)?.name).toBe('app');
    expect(resolveContainingRepo('/code/app', repos)?.name).toBe('app');
    expect(resolveContainingRepo('/code/application', repos)).toBeNull();
  });
});

describe('listCandidateRepos', () => {
  test('adds the repository shinsa do ran in when it lies outside the roots', async () => {
    const root = createRoot();
    const outside = await createGitRepo({ name: 'elsewhere' });
    expect((await listCandidateRepos([root], null)).map((repo) => repo.name)).toEqual(['newer', 'older']);
    const withOrigin = await listCandidateRepos([root], join(outside.path));
    expect(withOrigin[0]).toMatchObject({
      path: await git(outside.path, 'rev-parse', '--show-toplevel'),
      name: 'elsewhere',
    });
    expect((await listCandidateRepos([root], createTempDir())).map((repo) => repo.name)).toEqual([
      'newer',
      'older',
    ]);
    const inside = await listCandidateRepos([outside.root], outside.path);
    expect(inside.filter((repo) => repo.name === 'elsewhere')).toHaveLength(1);
  });
});
