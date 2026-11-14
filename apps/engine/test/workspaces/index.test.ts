import { describe, expect, test } from 'bun:test';
import { createGitRepo, createTempDir } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';
import { openWorkspaces } from './harness.ts';

describe('where agents work', () => {
  test('every task gets a worktree in the folder the root names', async () => {
    const root = createTempDir();
    const { runtime, workspaces } = openWorkspaces(root);
    const made = await createGitRepo();
    const checkout = await runtime.runPromise(
      workspaces.prepare(made.repo, createTask({ worktreePath: null }))
    );
    expect(checkout.path.startsWith(root)).toBe(true);
    expect(checkout.path).not.toBe(made.path);
  });
});
