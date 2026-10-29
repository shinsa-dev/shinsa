import { describe, expect, test } from 'bun:test';
import { describeWorkspaceProblem, Workspaces } from '../../src/workspaces/index.ts';
import { createGitRepo, createTempDir, writeFiles } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';

describe('where agents work', () => {
  test('each task runs on the strategy of the place it was set up in, worktrees by default', () => {
    const workspaces = new Workspaces({ worktreesDir: createTempDir() });
    expect(workspaces.resolve(createTask()).mode).toBe('worktrees');
    expect(workspaces.resolve(createTask({ workspace: 'worktrees' })).mode).toBe('worktrees');
    expect(workspaces.resolve(createTask({ workspace: 'main_checkout' })).mode).toBe('main_checkout');
  });

  test('the setup check names what stops agents working where the repository says', async () => {
    const plain = await createGitRepo();
    expect(await describeWorkspaceProblem(plain.repo, 'worktrees', false)).toBeNull();
    expect(await describeWorkspaceProblem(plain.repo, 'main_checkout', false)).toBeNull();
    writeFiles(plain.path, { 'mine.txt': 'mine\n' });
    expect(await describeWorkspaceProblem(plain.repo, 'worktrees', false)).toBeNull();
    expect(await describeWorkspaceProblem(plain.repo, 'main_checkout', false)).toMatchObject({
      kind: 'workspace',
      detail: expect.stringContaining('has uncommitted changes'),
    });
    expect(await describeWorkspaceProblem(plain.repo, 'main_checkout', true)).toBeNull();
  });
});
