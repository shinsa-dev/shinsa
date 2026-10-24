import { afterEach, describe, expect, test } from 'bun:test';
import { runCommandOrThrow } from '../../src/shell/index.ts';
import { isButInstalled, runBut } from '../../src/workspaces/but.ts';
import { describeWorkspaceProblem, listWorkspaceSupport, Workspaces } from '../../src/workspaces/index.ts';
import { createGitRepo, createTempDir, overrideEnv, writeFiles } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

function hideBut() {
  restores.push(overrideEnv({ FAKE_BUT_MISSING: '1' }));
}

describe('where agents work', () => {
  test('each task runs on the strategy of the place it was set up in, worktrees by default', () => {
    const workspaces = new Workspaces({ dataDir: createTempDir(), worktreesDir: createTempDir() });
    expect(workspaces.resolve(createTask()).mode).toBe('worktrees');
    expect(workspaces.resolve(createTask({ workspace: 'gitbutler' })).mode).toBe('gitbutler');
    expect(workspaces.resolve(createTask({ workspace: 'main_checkout' })).mode).toBe('main_checkout');
  });

  test('GitButler is offered for a repository only when `but` is installed and it is a GitButler workspace', async () => {
    const plain = await createGitRepo();
    const butler = await createGitRepo();
    await runCommandOrThrow(['but', 'setup', '--json'], butler.path);
    expect(
      await listWorkspaceSupport([
        { id: 'plain', path: plain.path },
        { id: 'butler', path: butler.path },
      ])
    ).toEqual({
      plain: { butInstalled: true, gitButlerWorkspace: false },
      butler: { butInstalled: true, gitButlerWorkspace: true },
    });
    hideBut();
    expect(await isButInstalled()).toBe(false);
    await expect(runBut(['status'], butler.path)).rejects.toThrow(
      'GitButler’s command line (`but`) is not installed or not on the PATH.'
    );
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
    await runCommandOrThrow(['but', 'setup', '--json'], butler.path);
    expect(await describeWorkspaceProblem(plain.repo, 'worktrees', false)).toBeNull();
    expect(await describeWorkspaceProblem(butler.repo, 'gitbutler', false)).toBeNull();
    expect(await describeWorkspaceProblem(plain.repo, 'gitbutler', false)).toEqual({
      kind: 'workspace',
      detail: `${plain.path} is not a GitButler workspace. Run \`but setup\` in it, or choose another place for agents to work in Settings → Projects.`,
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
