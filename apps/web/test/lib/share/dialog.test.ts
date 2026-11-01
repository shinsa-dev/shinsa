import { afterEach, describe, expect, it } from 'bun:test';
import { createSettings, HOUR_MS, USER_COMMAND_TYPES } from '@shinsa/core';
import { act, renderHook } from '@testing-library/react';
import {
  closeShareDialog,
  closeUnshareConfirm,
  describeShareEnd,
  isTaskShared,
  listShareLimitItems,
  openShareDialog,
  openUnshareConfirm,
  resolveShareLimitChoice,
  resolveShareView,
  selectLiveShare,
  shareTask,
  unshareTask,
  useShareDialog,
  useUnshareConfirm,
} from '@/lib/share/dialog.ts';
import { listTaskActions, runTaskAction } from '@/lib/tasks/actions.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { createTask } from '../../support/state.ts';

const ALL_COMMANDS: ReadonlySet<string> = new Set(USER_COMMAND_TYPES);

afterEach(() => {
  closeShareDialog();
  closeUnshareConfirm();
});

const PAIRED = createRemoteSnapshot({ paired: true });

const SHARING = { at: 1, limit: 'until_done', endsAt: null } as const;

describe('the share dialog', () => {
  it('opens for one task from its action and closes again', () => {
    const { result } = renderHook(() => useShareDialog());
    expect(result.current).toBeNull();
    act(() => runTaskAction(createTask({ id: 'source' }), 'share'));
    expect(result.current).toBe('source');
    act(() => closeShareDialog());
    expect(result.current).toBeNull();
    act(() => openShareDialog('other'));
    expect(result.current).toBe('other');
  });

  it('asks for remote access first, offers sharing once paired, and waits for the link', () => {
    const task = createTask({ id: 't' });
    expect(resolveShareView(task, createRemoteSnapshot({ paired: false }))).toEqual({ kind: 'unpaired' });
    expect(resolveShareView(task, PAIRED)).toEqual({ kind: 'off' });
    expect(resolveShareView(task, null)).toEqual({ kind: 'off' });
    expect(resolveShareView({ ...task, share: { ...SHARING, url: null } }, PAIRED)).toEqual({
      kind: 'linking',
    });
  });

  it('shows the link once it exists, and why publishing failed', () => {
    const task = createTask({ id: 't' });
    const url = 'https://app.shinsa.dev/share/t/abc';
    expect(resolveShareView({ ...task, share: { ...SHARING, url } }, null)).toEqual({ kind: 'shared', url });
    expect(
      resolveShareView({ ...task, share: { ...SHARING, url, failure: 'app.shinsa.dev refused it.' } }, PAIRED)
    ).toEqual({ kind: 'failed', message: 'app.shinsa.dev refused it.' });
  });

  it('shares and stops sharing with the human’s commands', async () => {
    const spies = spyOnCommands();
    const task = createTask({ id: 't' });
    await shareTask(task, 'day');
    await unshareTask(task);
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.share', taskId: 't', limit: 'day' }],
      [{ type: 'task.unshare', taskId: 't' }, 'Stopped sharing.'],
    ]);
    spies.restore();
  });
});

describe('how long a task is shared', () => {
  it('defaults to the setting, keeps a shared task’s own, and never ends at once on a finished task', () => {
    const settings = { ...createSettings(), shareLimit: 'week' as const };
    expect(resolveShareLimitChoice(createTask({ id: 't' }), createSettings())).toBe('until_done');
    expect(resolveShareLimitChoice(createTask({ id: 't' }), settings)).toBe('week');
    expect(
      resolveShareLimitChoice(
        createTask({ id: 't', share: { ...SHARING, url: null, limit: 'hour' } }),
        settings
      )
    ).toBe('hour');
    const done = createTask({ id: 't', stage: 'done' });
    expect(resolveShareLimitChoice(done, createSettings())).toBe('day');
    expect(listShareLimitItems(done).map((item) => item.value)).not.toContain('until_done');
    expect(listShareLimitItems(createTask({ id: 't' })).map((item) => item.value)).toContain('until_done');
  });

  it('says when sharing ends', () => {
    expect(describeShareEnd({ ...SHARING, url: null })).toBe('Sharing ends when the task is done');
    expect(describeShareEnd({ ...SHARING, url: null, limit: 'none' })).toBe('Shared until you stop it');
    expect(describeShareEnd({ ...SHARING, url: null, limit: 'hour', endsAt: 2 * HOUR_MS }, HOUR_MS)).toBe(
      'Sharing ends in 1h'
    );
  });
});

describe('stopping sharing', () => {
  it('asks first, from the task’s action', () => {
    const { result } = renderHook(() => useUnshareConfirm());
    const task = createTask({ id: 't', share: { ...SHARING, url: null } });
    expect(listTaskActions(task, ALL_COMMANDS).flat()).toContain('unshare');
    expect(listTaskActions(createTask({ id: 't' }), ALL_COMMANDS).flat()).not.toContain('unshare');
    act(() => runTaskAction(task, 'unshare'));
    expect(result.current).toBe('t');
    act(() => openUnshareConfirm('u'));
    expect(result.current).toBe('u');
  });
});

describe('a share whose time ran out', () => {
  it('reads as ended at once, before the machine ends it, for the banner, the dialog and the menu', () => {
    const url = 'https://app.shinsa.dev/share/t/abc';
    const task = createTask({ id: 't', share: { ...SHARING, url, limit: 'hour', endsAt: HOUR_MS } });
    expect(selectLiveShare(task, HOUR_MS - 1)?.url).toBe(url);
    expect(selectLiveShare(task, HOUR_MS)).toBeNull();
    expect(selectLiveShare(createTask({ id: 'u' }))).toBeNull();
    expect(resolveShareView(task, PAIRED, HOUR_MS - 1)).toEqual({ kind: 'shared', url });
    expect(resolveShareView(task, PAIRED, HOUR_MS)).toEqual({ kind: 'off' });
    expect(listTaskActions(task, ALL_COMMANDS, HOUR_MS - 1).flat()).toContain('unshare');
    expect(listTaskActions(task, ALL_COMMANDS, HOUR_MS).flat()).not.toContain('unshare');
  });
});

describe('whether a task shows as shared', () => {
  const url = 'https://app.shinsa.dev/share/t/abc';

  it('is shared only while its link works', () => {
    expect(isTaskShared(createTask({ id: 'a' }))).toBe(false);
    expect(isTaskShared(createTask({ id: 'a', share: { ...SHARING, url: null } }))).toBe(false);
    expect(isTaskShared(createTask({ id: 'a', share: { ...SHARING, url, failure: 'Refused.' } }))).toBe(
      false
    );
    expect(isTaskShared(createTask({ id: 'a', share: { ...SHARING, url } }))).toBe(true);
  });

  it('stops showing as shared once its time runs out', () => {
    const task = createTask({ id: 'a', share: { ...SHARING, url, limit: 'hour', endsAt: HOUR_MS } });
    expect(isTaskShared(task, HOUR_MS - 1)).toBe(true);
    expect(isTaskShared(task, HOUR_MS)).toBe(false);
  });
});
