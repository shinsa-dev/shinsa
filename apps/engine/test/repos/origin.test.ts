import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGitRepo, createTempDir, git, overrideEnv } from '../helpers/index.ts';
import { runCommandOrThrow } from '../helpers/shell.ts';
import { connectOrigin } from './harness.ts';

let remotes = '';
let restore = () => {};

beforeEach(() => {
  remotes = createTempDir('shinsa-remotes-');
  restore = overrideEnv({
    FAKE_GH_STATE: undefined,
    FAKE_GH_REMOTES: remotes,
    FAKE_GH_LOGIN: 'Octo',
    FAKE_GH_ORGS: undefined,
    FAKE_GH_FAIL_ORGS: undefined,
    FAKE_GH_FAIL_REPOS: undefined,
    FAKE_GH_CREATE_HIDDEN: undefined,
    FAKE_GH_GIT_PROTOCOL: undefined,
  });
});

afterEach(() => restore());

async function createLocalRepo() {
  const { repo, path } = await createGitRepo({ remote: false });
  return { target: { path, name: repo.name, defaultBranch: 'main' }, path };
}

async function createRemote(slug: string, commits = false) {
  const folder = join(remotes, slug);
  await runCommandOrThrow(['git', 'init', '--bare', '-q', '-b', 'main', folder], remotes);
  if (commits) {
    const { path } = await createGitRepo({ remote: false });
    await git(path, 'push', '-q', folder, 'main');
  }
  return folder;
}

async function readOrigin(path: string) {
  if (!(await git(path, 'remote')).includes('origin')) return null;
  return (await git(path, 'remote', 'get-url', 'origin')).trim();
}

async function readRemoteHead(folder: string) {
  return (await git(folder, 'rev-parse', 'refs/heads/main')).trim();
}

describe('connectOrigin', () => {
  test('a repository with no match on GitHub gets a new private one under your login, with its default branch pushed', async () => {
    const { target, path } = await createLocalRepo();
    const remote = await connectOrigin(target);
    const folder = join(remotes, 'octo/app');
    expect(remote).toBe(folder);
    expect(await readOrigin(path)).toBe(`file://${folder}`);
    expect(await readRemoteHead(folder)).toBe((await git(path, 'rev-parse', 'main')).trim());
    expect((await git(path, 'rev-parse', '--abbrev-ref', 'main@{upstream}')).trim()).toBe('origin/main');
  });

  test('an empty repository with the same name in one of your organizations is used instead of a duplicate', async () => {
    process.env.FAKE_GH_ORGS = 'acme,shinsa-dev';
    const folder = await createRemote('shinsa-dev/app');
    const { target, path } = await createLocalRepo();
    expect(await connectOrigin(target)).toBe(folder);
    expect(await readRemoteHead(folder)).toBe((await git(path, 'rev-parse', 'main')).trim());
    expect(existsSync(join(remotes, 'octo/app'))).toBe(false);
    expect(existsSync(join(remotes, 'acme/app'))).toBe(false);
  });

  test("the project's owner comes before your login, both to find a match and to create one", async () => {
    await createRemote('octo/app');
    const preferred = await createRemote('acme/app');
    const first = await createLocalRepo();
    expect(await connectOrigin(first.target, ['Acme', 'octo'])).toBe(preferred);

    const second = await createLocalRepo();
    const target = { ...second.target, name: 'fresh' };
    expect(await connectOrigin(target, ['acme'])).toBe(join(remotes, 'acme/fresh'));
  });

  test('a repository that already has origin keeps it, and gh is never asked', async () => {
    const { repo, path } = await createGitRepo();
    delete process.env.FAKE_GH_LOGIN;
    const remote = await connectOrigin({ path, name: repo.name, defaultBranch: 'main' });
    expect(remote).toBe(join(path, '..', 'origin'));
  });

  test('ssh as the gh git protocol connects with the ssh address', async () => {
    process.env.FAKE_GH_GIT_PROTOCOL = 'ssh';
    const { target, path } = await createLocalRepo();
    await connectOrigin(target);
    expect(await readOrigin(path)).toBe(join(remotes, 'octo/app'));
  });

  test('a match that already has commits is refused, with the command to connect it by hand', async () => {
    await createRemote('octo/app', true);
    const { target, path } = await createLocalRepo();
    await expect(connectOrigin(target)).rejects.toThrow(
      `github.com/octo/app already has commits, so I did not connect it to ${path}. Connect it yourself with \`git -C ${path} remote add origin https://github.com/octo/app.git && git -C ${path} push -u origin main\`, then try again.`
    );
    expect(await readOrigin(path)).toBeNull();
  });

  test('without a gh login nothing is looked up or created', async () => {
    delete process.env.FAKE_GH_LOGIN;
    const { target, path } = await createLocalRepo();
    await expect(connectOrigin(target, ['acme'])).rejects.toThrow(
      'gh could not tell which GitHub account to use: it failed with no output. Connect it yourself with'
    );
    await expect(connectOrigin(target, ['acme'])).rejects.toThrow('https://github.com/acme/app.git');
    expect(await readOrigin(path)).toBeNull();
    expect(existsSync(join(remotes, 'acme/app'))).toBe(false);
  });

  test('a failed organization list stops the lookup, so a duplicate is never created', async () => {
    process.env.FAKE_GH_FAIL_ORGS = 'HTTP 403: Resource not accessible';
    const { target } = await createLocalRepo();
    await expect(connectOrigin(target)).rejects.toThrow(
      'gh could not list your GitHub organizations: HTTP 403: Resource not accessible.'
    );
    expect(existsSync(join(remotes, 'octo/app'))).toBe(false);
  });

  test('a lookup GitHub cannot answer stops before anything is created', async () => {
    process.env.FAKE_GH_FAIL_REPOS = 'HTTP 502: Bad Gateway';
    const { target } = await createLocalRepo();
    await expect(connectOrigin(target)).rejects.toThrow(
      'gh could not check for github.com/octo/app: HTTP 502: Bad Gateway.'
    );
  });

  test('a repository gh cannot create, or cannot read back, is refused', async () => {
    const { target } = await createLocalRepo();
    process.env.FAKE_GH_CREATE_HIDDEN = '1';
    await expect(connectOrigin(target)).rejects.toThrow(
      'gh created github.com/octo/app, but it could not be read back.'
    );
    delete process.env.FAKE_GH_CREATE_HIDDEN;
    delete process.env.FAKE_GH_REMOTES;
    await expect(connectOrigin(target)).rejects.toThrow(
      'gh could not create github.com/octo/app: GraphQL: Name already exists on this account (createRepository).'
    );
  });

  test('a push that fails takes origin away again, so the next try starts over', async () => {
    mkdirSync(join(remotes, 'octo/app'), { recursive: true });
    const { target, path } = await createLocalRepo();
    await expect(connectOrigin(target)).rejects.toThrow('git could not push “main” to');
    expect(await readOrigin(path)).toBeNull();
  });

  test('origin that git cannot add is refused', async () => {
    const { target, path } = await createLocalRepo();
    chmodSync(join(path, '.git'), 0o555);
    try {
      await expect(connectOrigin(target)).rejects.toThrow('git could not add origin:');
    } finally {
      chmodSync(join(path, '.git'), 0o755);
    }
  });

  test('a default branch git would read as an option never reaches gh or git', async () => {
    const { target } = await createLocalRepo();
    await expect(connectOrigin({ ...target, defaultBranch: '--upload-pack=x' })).rejects.toThrow(
      'is not a branch name Shinsa will pass to git.'
    );
    expect(existsSync(join(remotes, 'octo/app'))).toBe(false);
  });
});
