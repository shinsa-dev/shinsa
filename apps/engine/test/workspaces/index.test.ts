import { afterEach, describe, expect, test } from 'bun:test';
import { needsButSetup, readButVersion, runBut } from '../../src/workspaces/but.ts';
import { describeWorkspaceProblem, listWorkspaceSupport, Workspaces } from '../../src/workspaces/index.ts';
import {
  createGitRepo,
  createTempDir,
  overrideEnv,
  startParallelBranches,
  writeFiles,
} from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
});

function hideBut() {
  restores.push(overrideEnv({ FAKE_BUT_MISSING: '1' }));
}

function pretendBut(version: string) {
  restores.push(overrideEnv({ FAKE_BUT_VERSION: version }));
}

describe('where agents work', () => {
  test('each task runs on the strategy of the place it was set up in, worktrees by default', () => {
    const workspaces = new Workspaces({ dataDir: createTempDir(), worktreesDir: createTempDir() });
    expect(workspaces.resolve(createTask()).mode).toBe('worktrees');
    expect(workspaces.resolve(createTask({ workspace: 'gitbutler' })).mode).toBe('gitbutler');
    expect(workspaces.resolve(createTask({ workspace: 'main_checkout' })).mode).toBe('main_checkout');
  });

  test('GitButler is offered where `but` is installed: in any repository from 0.23, before that only once set up', async () => {
    const plain = await createGitRepo();
    const butler = await createGitRepo();
    await startParallelBranches(butler.path);
    const repos = [
      { id: 'plain', path: plain.path },
      { id: 'butler', path: butler.path },
    ];
    pretendBut('0.23.0');
    expect(await listWorkspaceSupport(repos)).toEqual({
      plain: { butInstalled: true, gitButlerWorkspace: true },
      butler: { butInstalled: true, gitButlerWorkspace: true },
    });
    pretendBut('0.22.3');
    expect(await listWorkspaceSupport(repos)).toEqual({
      plain: { butInstalled: true, gitButlerWorkspace: false },
      butler: { butInstalled: true, gitButlerWorkspace: true },
    });
    hideBut();
    expect(await readButVersion()).toBeNull();
    expect(await listWorkspaceSupport(repos)).toEqual({
      plain: { butInstalled: false, gitButlerWorkspace: false },
      butler: { butInstalled: false, gitButlerWorkspace: false },
    });
    await expect(runBut(['status'], butler.path)).rejects.toThrow(
      'GitButler’s command line (`but`) is not installed or not on the PATH.'
    );
  });

  test('only a `but` older than 0.23 needs `but setup` in a repository first', async () => {
    pretendBut('0.22.3');
    expect(await readButVersion()).toBe('0.22.3');
    expect(needsButSetup('0.22.3')).toBe(true);
    expect(needsButSetup('0.23.0')).toBe(false);
    expect(needsButSetup('1.0.0')).toBe(false);
  });

  test('a failing `but` command says which one failed', async () => {
    const plain = await createGitRepo();
    await expect(runBut(['unapply', 'nothing-here'], plain.path)).rejects.toThrow(
      'but unapply nothing-here failed'
    );
  });

  test('the setup check names what stops agents working where the repository says', async () => {
    const plain = await createGitRepo();
    const butler = await createGitRepo();
    await startParallelBranches(butler.path);
    expect(await describeWorkspaceProblem(plain.repo, 'worktrees', false)).toBeNull();
    pretendBut('0.23.0');
    expect(await describeWorkspaceProblem(plain.repo, 'gitbutler', false)).toBeNull();
    pretendBut('0.22.3');
    expect(await describeWorkspaceProblem(butler.repo, 'gitbutler', false)).toBeNull();
    expect(await describeWorkspaceProblem(plain.repo, 'gitbutler', false)).toEqual({
      kind: 'workspace',
      detail: `${plain.path} is not a GitButler workspace, which \`but\` 0.22.3 needs. Update \`but\` (0.23 and newer work in any repository) or run \`but setup\` in it, or choose another place for agents to work in Settings → Projects.`,
    });
    expect(await describeWorkspaceProblem(butler.repo, 'main_checkout', false)).toEqual({
      kind: 'workspace',
      detail: 'app is a GitButler workspace, so agents cannot switch its checkout to a branch of their own.',
    });
    expect(await describeWorkspaceProblem(plain.repo, 'main_checkout', false)).toBeNull();
    writeFiles(plain.path, { 'mine.txt': 'mine\n' });
    expect(await describeWorkspaceProblem(plain.repo, 'main_checkout', false)).toMatchObject({
      kind: 'workspace',
      detail: expect.stringContaining('has uncommitted changes'),
    });
    expect(await describeWorkspaceProblem(plain.repo, 'main_checkout', true)).toBeNull();
    hideBut();
    expect(await describeWorkspaceProblem(butler.repo, 'gitbutler', false)).toEqual({
      kind: 'workspace',
      detail:
        'Agents work on GitButler branches here, but GitButler’s command line (`but`) is not installed.',
    });
  });
});
