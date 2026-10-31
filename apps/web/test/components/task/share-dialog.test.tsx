import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { Task } from '@shinsa/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ShareDialog, UnshareConfirm } from '@/components/task/share-dialog.tsx';
import { SharingBanner } from '@/components/task/sharing-banner.tsx';
import { connection } from '@/lib/connection/socket.ts';
import { closeShareDialog, closeUnshareConfirm, openShareDialog } from '@/lib/share/dialog.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

function showTask(overrides: Partial<Task> = {}, paired = true) {
  const snapshot = createRemoteSnapshot({ paired });
  spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(snapshot));
  act(() => connection.replaceRemote(snapshot));
  pushState(createShinsaState({ tasks: [createTask({ id: 'source', handle: 'SW-2', ...overrides })] }));
  render(
    <>
      <ShareDialog />
      <UnshareConfirm />
    </>
  );
  act(() => openShareDialog('source'));
}

const URL = 'https://app.shinsa.dev/share/abc';

const SHARING = { at: 1, limit: 'until_done', endsAt: null } as const;

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  act(() => {
    closeShareDialog();
    closeUnshareConfirm();
  });
  stopFakeServer();
  mock.restore();
});

describe('the share dialog', () => {
  it('says sharing needs remote access and opens its settings', async () => {
    showTask({}, false);
    expect(await screen.findByText(/reads this task from this machine through remote access/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Settings' }));
    expect(location.pathname).toBe('/settings');
  });

  it('shares the task for as long as you pick', async () => {
    showTask();
    expect(await screen.findByRole('combobox', { name: 'Share for' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'task.share', taskId: 'source', limit: 'until_done' }])
    );
  });

  it('waits for the link while it is made', async () => {
    showTask({ share: { ...SHARING, url: null } });
    expect(await screen.findByText('Making the link')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeTruthy();
  });

  it('shows the link to copy inside its field, and stops sharing once you confirm', async () => {
    showTask({ share: { ...SHARING, url: URL } });
    const link = (await screen.findByRole('textbox', { name: 'Share link' })) as HTMLInputElement;
    expect(link.value).toBe(URL);
    expect(link.parentElement?.querySelector('button[aria-label="Copy"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('The link stops working at once');
    expect(listSentCommands()).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop sharing' }));
    await waitFor(() => expect(listSentCommands()).toEqual([{ type: 'task.unshare', taskId: 'source' }]));
  });

  it('says why the link could not be made and tries again', async () => {
    showTask({ share: { ...SHARING, url: null, failure: 'Remote access was removed.' } });
    expect((await screen.findByRole('alert')).textContent).toBe('Remote access was removed.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'task.share', taskId: 'source', limit: 'until_done' }])
    );
  });
});

describe('the sharing banner', () => {
  it('stays on a shared task with how long it is shared, its link and Stop sharing', async () => {
    showTask({ share: { ...SHARING, url: URL } });
    act(() => closeShareDialog());
    const task = createTask({ id: 'source', share: { ...SHARING, url: URL } });
    const { rerender } = render(<SharingBanner task={task} />);
    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('Anyone with the link can watch this task.');
    expect(banner.textContent).toContain('Sharing ends when the task is done.');
    expect(within(banner).queryByRole('button', { name: /dismiss|close/i })).toBeNull();
    expect(within(banner).getByRole('button', { name: 'Copy link' })).toBeTruthy();
    fireEvent.click(within(banner).getByRole('button', { name: 'Stop sharing' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    rerender(<SharingBanner task={createTask({ id: 'source' })} />);
    expect(screen.queryByText('Anyone with the link can watch this task.')).toBeNull();
  });
});
