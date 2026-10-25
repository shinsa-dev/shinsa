import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  changeWorkspace,
  describeGitButlerSupport,
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
    expect(resolveWorkspaceLabel(createRepo({ id: 'web', workspace: 'gitbutler' }))).toBe('GitButler');
    expect(resolveWorkspaceLabel(createRepo({ id: 'web', workspace: 'main_checkout' }))).toBe(
      'Main checkout'
    );
  });

  it('says why GitButler cannot be chosen yet, or nothing once it can', () => {
    expect(describeGitButlerSupport(undefined)).toBe('Checking whether GitButler is set up here.');
    expect(describeGitButlerSupport({ butInstalled: false, gitButlerWorkspace: true })).toBe(
      'Install GitButler’s command line (`but`) to use it.'
    );
    expect(describeGitButlerSupport({ butInstalled: true, gitButlerWorkspace: false })).toBe(
      'Run `but setup` in this repository to use it.'
    );
    expect(describeGitButlerSupport({ butInstalled: true, gitButlerWorkspace: true })).toBeNull();
  });

  it('offers the three modes, GitButler held back with its reason until it is set up, unless it is already chosen', () => {
    const web = createRepo({ id: 'web' });
    const [worktrees, gitbutler, checkout] = listWorkspaceItems(web, null);
    expect(worktrees).toMatchObject({ value: 'worktrees', label: 'Worktrees' });
    expect(worktrees?.disabled).toBeUndefined();
    expect(gitbutler).toMatchObject({
      value: 'gitbutler',
      disabled: 'Checking whether GitButler is set up here.',
      hint: expect.stringContaining('test them together'),
    });
    expect(checkout).toMatchObject({ value: 'main_checkout', label: 'Main checkout' });
    expect(checkout?.disabled).toBeUndefined();
    const ready = listWorkspaceItems(web, { web: { butInstalled: true, gitButlerWorkspace: true } });
    expect(ready[1]?.disabled).toBeUndefined();
    const chosen = listWorkspaceItems(createRepo({ id: 'web', workspace: 'gitbutler' }), {});
    expect(chosen[1]?.disabled).toBeUndefined();
  });

  it('saves a new mode with a toast that says what changes, and does nothing for the current one', async () => {
    const web = createRepo({ id: 'web' });
    expect(describeWorkspaceChange(web, 'gitbutler')).toBe(
      'New tasks in web get a branch each in the GitButler workspace. Tasks already working keep where they are.'
    );
    expect(await changeWorkspace(web, 'worktrees')).toBe(true);
    expect(spies.sent).not.toHaveBeenCalled();
    await changeWorkspace(web, 'gitbutler');
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'repo.update', repoId: 'web', patch: { workspace: 'gitbutler' } },
      describeWorkspaceChange(web, 'gitbutler')
    );
    expect(describeWorkspaceChange(web, 'worktrees')).toContain('get a worktree each');
  });

  it('keys the repositories so support is read again only when they change', () => {
    expect(resolveRepoKey([createRepo({ id: 'b' }), createRepo({ id: 'a' })])).toBe('a,b');
  });
});
