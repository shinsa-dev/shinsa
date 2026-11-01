import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { ENGINE_BASELINE_COMMANDS, type Task, USER_COMMAND_TYPES } from '@shinsa/core';
import { listTaskActions, runTaskAction, TASK_ACTION, TASK_ACTION_COMMAND } from '@/lib/tasks/actions.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createTask, NOW } from '../../support/state.ts';

const PULL_REQUEST: NonNullable<Task['pullRequest']> = {
  number: 42,
  url: 'https://github.com/acme/app/pull/42',
  state: 'open',
  checks: 'passing',
  unresolvedComments: 0,
  mergeable: true,
  updatedAt: NOW,
};

const FULL = createTask({
  id: 'full',
  pullRequest: PULL_REQUEST,
  branch: 'fix/tabs',
  worktreePath: '/tmp/worktrees/full',
});

const ALL_COMMANDS: ReadonlySet<string> = new Set(USER_COMMAND_TYPES);

describe('listTaskActions', () => {
  it('leaves out an action whose command the task’s engine does not speak', () => {
    const baseline = new Set<string>(ENGINE_BASELINE_COMMANDS);
    expect(listTaskActions(FULL, baseline).flat()).not.toContain('share');
    expect(listTaskActions(FULL, baseline).flat()).toContain('fork');
    expect(listTaskActions(createTask({ id: 't', stage: 'cancelled' }), baseline)).toEqual([]);
    expect(listTaskActions(FULL, new Set()).flat()).toEqual([
      'pullRequest',
      'branch',
      'editor',
      'terminal',
      'finder',
    ]);
    expect(TASK_ACTION_COMMAND.share).toBe('task.share');
    expect(TASK_ACTION_COMMAND.unshare).toBe('task.unshare');
  });

  it('groups links, worktree actions and lifecycle actions', () => {
    expect(listTaskActions(FULL, ALL_COMMANDS)).toEqual([
      ['pullRequest', 'branch'],
      ['editor', 'terminal', 'finder'],
      ['fork', 'share'],
      ['snooze'],
      ['restart', 'complete', 'duplicate', 'cancel'],
    ]);
  });

  it('drops groups that do not apply, and lifecycle actions once the task is settled', () => {
    expect(listTaskActions(createTask({ id: 't', branch: 'fix/tabs' }), ALL_COMMANDS)).toEqual([
      ['branch'],
      ['fork', 'share'],
      ['snooze'],
      ['restart', 'complete', 'duplicate', 'cancel'],
    ]);
    expect(listTaskActions(createTask({ id: 't', stage: 'merged' }), ALL_COMMANDS)).toEqual([
      ['fork', 'share'],
    ]);
    expect(listTaskActions(createTask({ id: 't', stage: 'cancelled' }), ALL_COMMANDS)).toEqual([['share']]);
    expect(
      listTaskActions(createTask({ id: 't', stage: 'cancelled', watchHome: true }), ALL_COMMANDS)
    ).toEqual([]);
    const closed = createTask({
      id: 't',
      stage: 'cancelled',
      duplicate: { of: 'o', by: 'shinsa', why: null },
    });
    expect(listTaskActions(closed, ALL_COMMANDS)).toEqual([['share'], ['notDuplicate']]);
    expect(
      listTaskActions({ ...closed, duplicate: { of: 'o', by: 'you', why: null } }, ALL_COMMANDS)
    ).toEqual([['share'], ['notDuplicate']]);
    expect(listTaskActions({ ...closed, duplicate: null }, ALL_COMMANDS)).toEqual([['share']]);
  });

  it('offers Move to the backlog before building starts, and Remove from the backlog once it is there', () => {
    expect(listTaskActions(createTask({ id: 't', stage: 'planning' }), ALL_COMMANDS)).toEqual([
      ['fork', 'share'],
      ['moveToBacklog', 'snooze'],
      ['restart', 'complete', 'duplicate', 'cancel'],
    ]);
    expect(
      listTaskActions(createTask({ id: 't', stage: 'awaiting_plan', backlog: { at: 1 } }), ALL_COMMANDS)[1]
    ).toEqual(['removeFromBacklog', 'snooze']);
  });

  it('offers only Stop sharing while a task is shared, and Share task again to retry a link that failed', () => {
    const share = { at: 1, limit: 'until_done', endsAt: null } as const;
    const shared = createTask({
      id: 't',
      stage: 'merged',
      share: { ...share, url: 'https://app.shinsa.dev/share/t/a' },
    });
    expect(listTaskActions(shared, ALL_COMMANDS)).toEqual([['fork', 'unshare']]);
    const failed = createTask({
      id: 't',
      stage: 'merged',
      share: { ...share, url: null, failure: 'Refused.' },
    });
    expect(listTaskActions(failed, ALL_COMMANDS)).toEqual([['fork', 'share', 'unshare']]);
  });

  it('offers Unsnooze on a snoozed task, and neither once it is settled', () => {
    expect(listTaskActions(createTask({ id: 't', snoozed: { at: 1 } }), ALL_COMMANDS)[1]).toEqual([
      'unsnooze',
    ]);
    expect(
      listTaskActions(createTask({ id: 't', stage: 'merged', snoozed: { at: 1 } }), ALL_COMMANDS)
    ).toEqual([['fork', 'share']]);
  });

  it('labels every action with its icon', () => {
    expect(TASK_ACTION.cancel).toEqual({ label: 'Cancel task', icon: 'IconCircleX' });
    expect(TASK_ACTION.branch.label).toBe('Copy branch name');
  });
});

describe('runTaskAction', () => {
  let spies: ReturnType<typeof spyOnCommands>;

  beforeEach(() => {
    spies = spyOnCommands();
  });

  afterEach(() => {
    spies.restore();
  });

  it('opens the task page', () => {
    runTaskAction(FULL, 'open');
    expect(location.pathname).toBe('/tasks/full');
  });

  it('opens the pull request in a new tab', () => {
    const open = spyOn(window, 'open').mockReturnValue(null);
    runTaskAction(FULL, 'pullRequest');
    runTaskAction(createTask({ id: 't' }), 'pullRequest');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(PULL_REQUEST.url, '_blank', 'noopener');
    open.mockRestore();
  });

  it('copies the branch name when there is one', () => {
    runTaskAction(FULL, 'branch');
    runTaskAction(createTask({ id: 't' }), 'branch');
    expect(spies.copied).toHaveBeenCalledTimes(1);
    expect(spies.copied).toHaveBeenCalledWith('fix/tabs');
  });

  it('opens the worktree in the editor or Finder, and a terminal in Shinsa', () => {
    runTaskAction(FULL, 'editor');
    runTaskAction(FULL, 'terminal');
    runTaskAction(FULL, 'finder');
    expect(spies.opened.mock.calls).toEqual([
      ['full', 'editor'],
      ['full', 'finder'],
    ]);
    expect(spies.terminal).toHaveBeenCalledWith(FULL);
  });

  it('sends restart, complete and cancel with a toast for each', () => {
    runTaskAction(FULL, 'restart');
    runTaskAction(FULL, 'complete');
    runTaskAction(FULL, 'cancel');
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.retry', taskId: 'full' }, 'Restarted.'],
      [{ type: 'task.complete', taskId: 'full' }, 'Marked done.'],
      [{ type: 'task.cancel', taskId: 'full' }, 'Cancelled.'],
    ]);
  });

  it('snoozes a task and unsnoozes it, with a toast for each', () => {
    runTaskAction(FULL, 'snooze');
    runTaskAction(FULL, 'unsnooze');
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.snooze', taskId: 'full' }, 'Snoozed.'],
      [{ type: 'task.unsnooze', taskId: 'full' }, 'Unsnoozed.'],
    ]);
  });

  it('moves a task into the backlog and back to Needs you', () => {
    runTaskAction(FULL, 'moveToBacklog');
    runTaskAction(FULL, 'removeFromBacklog');
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.move_to_backlog', taskId: 'full' }, 'Moved to the backlog.'],
      [{ type: 'task.remove_from_backlog', taskId: 'full' }, 'Removed from the backlog.'],
    ]);
  });
});
