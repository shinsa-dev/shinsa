import { afterEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  closeShareDialog,
  openShareDialog,
  resolveShareView,
  shareTask,
  unshareTask,
  useShareDialog,
} from '@/lib/share/dialog.ts';
import { runTaskAction } from '@/lib/tasks/actions.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { createTask } from '../../support/state.ts';

afterEach(() => {
  closeShareDialog();
});

const PAIRED = createRemoteSnapshot({ paired: true });

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
    expect(resolveShareView({ ...task, share: { at: 1, url: null } }, PAIRED)).toEqual({
      kind: 'linking',
    });
  });

  it('shows the link once it exists, and why publishing failed', () => {
    const task = createTask({ id: 't' });
    const url = 'https://app.shinsa.dev/share/abc';
    expect(resolveShareView({ ...task, share: { at: 1, url } }, null)).toEqual({ kind: 'shared', url });
    expect(
      resolveShareView({ ...task, share: { at: 1, url, failure: 'app.shinsa.dev refused it.' } }, PAIRED)
    ).toEqual({ kind: 'failed', message: 'app.shinsa.dev refused it.' });
  });

  it('shares and stops sharing with the human’s commands', async () => {
    const spies = spyOnCommands();
    const task = createTask({ id: 't' });
    await shareTask(task);
    await unshareTask(task);
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.share', taskId: 't' }],
      [{ type: 'task.unshare', taskId: 't' }, 'Stopped sharing. The link no longer opens this task.'],
    ]);
    spies.restore();
  });
});
