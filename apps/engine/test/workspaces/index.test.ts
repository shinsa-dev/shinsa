import { describe, expect, test } from 'bun:test';
import { createGitRepo, createTempDir, writeFiles } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';
import { openStrategy, openWorkspaces } from './harness.ts';

describe('where agents work', () => {
  test('each task runs on the strategy of the place it was set up in, worktrees by default', () => {
    const { workspaces } = openWorkspaces(createTempDir());
    expect(workspaces.resolve(createTask()).mode).toBe('worktrees');
    expect(workspaces.resolve(createTask({ workspace: 'worktrees' })).mode).toBe('worktrees');
    expect(workspaces.resolve(createTask({ workspace: 'main_checkout' })).mode).toBe('main_checkout');
  });

  test('the setup check names what stops agents working where the repository says', async () => {
    const plain = await createGitRepo();
    expect(await openStrategy('worktrees').describeProblem(plain.repo, false)).toBeNull();
    expect(await openStrategy('main_checkout').describeProblem(plain.repo, false)).toBeNull();
    writeFiles(plain.path, { 'mine.txt': 'mine\n' });
    expect(await openStrategy('worktrees').describeProblem(plain.repo, false)).toBeNull();
    expect(await openStrategy('main_checkout').describeProblem(plain.repo, false)).toMatchObject({
      kind: 'workspace',
      detail: expect.stringContaining('has uncommitted changes'),
    });
    expect(await openStrategy('main_checkout').describeProblem(plain.repo, true)).toBeNull();
  });
});
