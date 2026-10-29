import { describe, expect, test } from 'bun:test';
import { mkdirSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createLoginResolver,
  listCandidateRepos,
  listLocalRepos,
  resolveContainingRepo,
  resolveProjectName,
  syncRepoRemote,
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

describe('project names', () => {
  test('the user’s own repositories are Personal, others are named after their owner', async () => {
    const login = () => Promise.resolve('christo');
    expect(await resolveProjectName(null, login)).toBe('Local');
    expect(await resolveProjectName('github.com/Christo/app', login)).toBe('Personal');
    expect(await resolveProjectName('github.com/superwall-me/paywall', login)).toBe('Superwall Me');
  });

  test('the GitHub login is read from gh once it answers, and a failed read is tried again', async () => {
    const resolveLogin = createLoginResolver(createTempDir());
    const restores = [overrideEnv({ FAKE_GH_LOGIN: undefined, FAKE_GH_STATE: undefined })];
    try {
      expect(await resolveLogin()).toBeNull();
      restores.push(overrideEnv({ FAKE_GH_LOGIN: 'Christo' }));
      expect(await resolveLogin()).toBe('christo');
      restores.push(overrideEnv({ FAKE_GH_LOGIN: 'Someone' }));
      expect(await resolveLogin()).toBe('christo');
    } finally {
      for (const restore of restores.reverse()) restore();
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

  test('a registration is named after the folder and the log position, or after the effect that asks for it, so a resend lands once', async () => {
    const { path } = await createGitRepo();
    const stub = createStubEngine();
    const login = () => Promise.resolve(null);
    stub.state.seq = 12;
    await expect(upsertRepo(stub.engine, path, login)).rejects.toThrow('Could not register app.');
    expect(stub.commandIds).toEqual([`repo:${await git(path, 'rev-parse', '--show-toplevel')}:12`]);
    await expect(
      upsertRepo(stub.engine, path, login, null, { id: 'triage:t1:repo.register' })
    ).rejects.toThrow('Could not register app.');
    expect(stub.commandIds.at(-1)).toBe('triage:t1:repo.register');

    const engine = new Engine(new EventLog(join(createTempDir(), 'db.sqlite')));
    const concurrent = await Promise.all([upsertRepo(engine, path, login), upsertRepo(engine, path, login)]);
    expect(concurrent[0].id).toBe(concurrent[1].id);
    expect(Object.keys(engine.state.repos)).toHaveLength(1);
  });

  test('a repository registered before it had an origin gets its remote once origin exists', async () => {
    const { path } = await createGitRepo({ remote: false });
    const engine = new Engine(new EventLog(join(createTempDir(), 'db.sqlite')));
    const login = () => Promise.resolve(null);
    const first = await upsertRepo(engine, path, login);
    expect(first.remote).toBeNull();
    expect(await syncRepoRemote(engine, first)).toBe(first);
    await git(path, 'remote', 'add', 'origin', 'git@github.com:acme/app.git');
    const again = await upsertRepo(engine, path, login);
    expect(again).toMatchObject({ id: first.id, remote: 'github.com/acme/app' });
    expect(engine.state.repos[first.id]?.remote).toBe('github.com/acme/app');
    await git(path, 'remote', 'set-url', 'origin', 'https://github.com/acme/other.git');
    expect((await upsertRepo(engine, path, login)).remote).toBe('github.com/acme/app');
  });

  test('syncing a repository fills in a missing remote from origin and leaves a known one alone', async () => {
    const { path } = await createGitRepo({ remote: false });
    const engine = new Engine(new EventLog(join(createTempDir(), 'db.sqlite')));
    const repo = await upsertRepo(engine, path, () => Promise.resolve(null));
    await git(path, 'remote', 'add', 'origin', 'https://github.com/acme/app.git');
    const synced = await syncRepoRemote(engine, repo);
    expect(synced).toMatchObject({ id: repo.id, remote: 'github.com/acme/app' });
    await git(path, 'remote', 'set-url', 'origin', 'https://github.com/acme/other.git');
    expect(await syncRepoRemote(engine, synced)).toBe(synced);
  });

  test('a registration that does not land is an error', async () => {
    const { path } = await createGitRepo({ remote: false });
    const { engine } = createStubEngine();
    await expect(upsertRepo(engine, path, () => Promise.resolve(null))).rejects.toThrow(
      'Could not register app.'
    );
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
