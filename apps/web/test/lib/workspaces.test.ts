import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  changeWorkspace,
  describeWorkspaceChange,
  listWorkspaceItems,
  resolveRepoKey,
  resolveWorkspaceLabel,
} from '@/lib/workspaces.ts';
import { spyOnCommands } from '../support/commands.ts';
import { createRepo } from '../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

describe('where agents work', () => {
  it('names the mode a repository works in, worktrees until you choose otherwise', () => {
    expect(resolveWorkspaceLabel(createRepo({ id: 'web' }))).toBe('Worktrees');
    expect(resolveWorkspaceLabel(createRepo({ id: 'web', workspace: 'main_checkout' }))).toBe(
      'Main checkout'
    );
  });

  it('offers worktrees and the main checkout, each with what it means', () => {
    const [worktrees, checkout, ...rest] = listWorkspaceItems();
    expect(worktrees).toMatchObject({
      value: 'worktrees',
      label: 'Worktrees',
      hint: expect.stringContaining('worktree'),
    });
    expect(checkout).toMatchObject({
      value: 'main_checkout',
      label: 'Main checkout',
      hint: expect.stringContaining('one task at a time'),
    });
    expect(rest).toEqual([]);
  });

  it('saves a new mode with a toast that says what changes, and does nothing for the current one', async () => {
    const web = createRepo({ id: 'web' });
    expect(describeWorkspaceChange(web, 'main_checkout')).toBe('One task at a time in web.');
    expect(await changeWorkspace(web, 'worktrees')).toBe(true);
    expect(spies.sent).not.toHaveBeenCalled();
    await changeWorkspace(web, 'main_checkout');
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'repo.update', repoId: 'web', patch: { workspace: 'main_checkout' } },
      describeWorkspaceChange(web, 'main_checkout')
    );
    expect(describeWorkspaceChange(web, 'worktrees')).toBe('A worktree per task in web.');
  });

  it('keys the repositories so what they report is read again only when they change', () => {
    expect(resolveRepoKey([createRepo({ id: 'b' }), createRepo({ id: 'a' })])).toBe('a,b');
  });
});
