import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { Task } from '@shinsa/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HandoffRemoveConfirm, ShareDialog, UnshareConfirm } from '@/components/task/share-dialog.tsx';
import { HandoffBanner, SharingBanner } from '@/components/task/sharing-banner.tsx';
import { connection } from '@/lib/connection/socket.ts';
import { closeShareDialog, closeUnshareConfirm, openShareDialog } from '@/lib/share/dialog.ts';
import { closeHandoffRemoveConfirm } from '@/lib/share/handoff.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState, createTask } from '../../support/state.ts';
import { waitForGone } from '../../support/wait.ts';

function showTask(overrides: Partial<Task> = {}, paired = true) {
  const snapshot = createRemoteSnapshot({ paired });
  spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(snapshot));
  act(() => connection.replaceRemote(snapshot));
  pushState(createShinsaState({ tasks: [createTask({ id: 'source', handle: 'SW-2', ...overrides })] }));
  render(
    <>
      <ShareDialog />
      <UnshareConfirm />
      <HandoffRemoveConfirm />
    </>
  );
  act(() => openShareDialog('source'));
}

async function choose(label: string, option: RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
  const item = within(list).getByRole('option', { name: option });
  fireEvent.pointerDown(item, { pointerType: 'mouse' });
  fireEvent.click(item);
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

const URL = 'https://app.shinsa.dev/share/t/abc';

const SHARING = { at: 1, limit: 'until_done', preset: 'standard', endsAt: null } as const;

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  act(() => {
    closeShareDialog();
    closeUnshareConfirm();
    closeHandoffRemoveConfirm();
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
      expect(listSentCommands()).toEqual([
        { type: 'task.share', taskId: 'source', limit: 'until_done', preset: 'standard' },
      ])
    );
  });

  it('shares it as the preset you pick, Standard by default', async () => {
    showTask();
    const picker = await screen.findByRole('combobox', { name: 'Share as' });
    expect(picker.textContent).toBe('Standard');
    await choose('Share as', /^Status/);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'task.share', taskId: 'source', limit: 'until_done', preset: 'status' },
      ])
    );
  });

  it('keeps Share loading until the link is made', async () => {
    showTask({ share: { ...SHARING, url: null } });
    const share = (await screen.findByText('Share')).closest('button');
    expect(share?.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('textbox', { name: 'Share link' })).toBeNull();
  });

  it('closes once the link is made, leaving the banner to copy it', async () => {
    showTask({ share: { ...SHARING, url: null } });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    act(() =>
      pushState(
        createShinsaState({
          tasks: [createTask({ id: 'source', handle: 'SW-2', share: { ...SHARING, url: URL } })],
        })
      )
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('textbox', { name: 'Share link' })).toBeNull();
  });

  it('stays open on a shared task and changes what it shares and how long at once, keeping the link', async () => {
    showTask({ share: { ...SHARING, url: URL } });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Share as' }).textContent).toBe('Standard');
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    await choose('Share as', /^Full access/);
    await choose('Share for', /^24 hours/);
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'task.share', taskId: 'source', preset: 'full' },
        { type: 'task.share', taskId: 'source', limit: 'day' },
      ])
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('stops a share whose link failed once you confirm', async () => {
    showTask({ share: { ...SHARING, url: null, failure: 'Remote access was removed.' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop sharing' }));
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
      expect(listSentCommands()).toEqual([
        { type: 'task.share', taskId: 'source', limit: 'until_done', preset: 'standard' },
      ])
    );
  });
});

const KAI = { id: 'u2', login: 'kai', name: 'Kai Lane', avatarUrl: null };

const HANDED = { at: 1, url: null, guest: null, claimedAt: null };

async function findHandoff() {
  return within(await screen.findByRole('dialog'));
}

describe('handing a task off as a kind of share', () => {
  it('lists Hand off beside the presets and hands the task off without sharing it', async () => {
    showTask();
    await screen.findByRole('combobox', { name: 'Share as' });
    await choose('Share as', /^Hand off/);
    const dialog = await findHandoff();
    expect(dialog.getByText(/The first GitHub account to open the link/).textContent).toContain(
      'It stays yours'
    );
    expect(dialog.queryByRole('combobox', { name: 'Share for' })).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Hand off' }));
    await waitFor(() => expect(listSentCommands()).toEqual([{ type: 'task.hand_off', taskId: 'source' }]));
    act(() =>
      pushState(createShinsaState({ tasks: [createTask({ id: 'source', handle: 'SW-2', handoff: HANDED })] }))
    );
    await waitFor(() =>
      expect(document.querySelector('[data-slot="dialog-footer"] button')?.getAttribute('aria-busy')).toBe(
        'true'
      )
    );
  });

  it('goes back to sharing when a preset is picked again', async () => {
    showTask({ handoff: { ...HANDED, url: 'https://app.shinsa.dev/claim#x' } });
    expect((await screen.findByRole('combobox', { name: 'Share as' })).textContent).toBe('Hand off');
    await choose('Share as', /^Standard/);
    expect(screen.getByRole('combobox', { name: 'Share for' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(listSentCommands()).toEqual([]);
  });

  it('changes a live share’s preset but never sends one for Hand off', async () => {
    showTask({ share: { ...SHARING, url: URL } });
    await screen.findByRole('combobox', { name: 'Share as' });
    await choose('Share as', /^Hand off/);
    await choose('Share as', /^Status/);
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'task.share', taskId: 'source', preset: 'status' }])
    );
  });

  it('copies the link to send and turns it off', async () => {
    const writeText = spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    showTask({ handoff: { ...HANDED, url: 'https://app.shinsa.dev/claim#x' } });
    const dialog = await findHandoff();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy hand-off link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://app.shinsa.dev/claim#x'));
    fireEvent.click(dialog.getByRole('button', { name: 'Turn off link' }));
    await waitFor(() => expect(listSentCommands()).toEqual([{ type: 'handoff.remove', taskId: 'source' }]));
    fireEvent.click(dialog.getByRole('button', { name: 'Done' }));
    await waitForGone(() => screen.queryByRole('dialog'));
  });

  it('says why the link failed and tries again', async () => {
    showTask({ handoff: { ...HANDED, failure: 'Remote access is off.' } });
    expect((await screen.findByRole('alert')).textContent).toBe('Remote access is off.');
    const dialog = await findHandoff();
    fireEvent.click(dialog.getByRole('button', { name: 'Try again' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'task.hand_off', taskId: 'source' },
        { type: 'handoff.remove', taskId: 'source' },
      ])
    );
  });

  it('shows who is working on it, that it stays yours, and removes them once you confirm', async () => {
    showTask({ stage: 'done', handoff: { ...HANDED, guest: KAI, claimedAt: Date.now() } });
    const dialog = await findHandoff();
    const text = (await screen.findByRole('dialog')).textContent;
    expect(text).toContain('Kai Lane is working on this task. It stays yours');
    expect(text).toContain('@kai');
    expect(text).toContain('Joined just now');
    fireEvent.click(dialog.getByRole('button', { name: 'Remove' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm.textContent).toContain('Remove Kai Lane?');
    expect(listSentCommands()).toEqual([]);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(listSentCommands()).toEqual([{ type: 'handoff.remove', taskId: 'source' }]));
  });

  it('offers no hand-off on a finished task', async () => {
    showTask({ stage: 'done' });
    fireEvent.click(await screen.findByRole('combobox', { name: 'Share as' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
    expect(within(list).queryByRole('option', { name: /^Hand off/ })).toBeNull();
  });

  it('offers no hand-off before remote access is on', async () => {
    showTask({ handoff: HANDED }, false);
    expect(await screen.findByRole('button', { name: 'Open Settings' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Share as' })).toBeNull();
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
  it('opens the dialog from Manage to change what the link shares', async () => {
    showTask({ share: { ...SHARING, preset: 'status', url: URL } });
    act(() => closeShareDialog());
    render(
      <SharingBanner task={createTask({ id: 'source', share: { ...SHARING, preset: 'status', url: URL } })} />
    );
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Manage' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('says how soon a timed share ends, never a date for an hour away', () => {
    const endsAt = Date.now() + 60 * 60 * 1000;
    render(
      <SharingBanner
        task={createTask({
          id: 'source',
          share: { at: 1, limit: 'hour', preset: 'standard', endsAt, url: URL },
        })}
      />
    );
    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('Sharing ends in 1h.');
    expect(banner.querySelector('time')?.getAttribute('datetime')).toBe(new Date(endsAt).toISOString());
  });
});

describe('the hand-off banner', () => {
  const claimed = { ...HANDED, guest: KAI, claimedAt: Date.now() };

  it('says who works on a shared task beside the sharing banner, and each Manage opens its own part', async () => {
    showTask({ share: { ...SHARING, preset: 'status', url: URL }, handoff: claimed });
    act(() => closeShareDialog());
    await waitForGone(() => screen.queryByRole('dialog'));
    const task = createTask({
      id: 'source',
      share: { ...SHARING, preset: 'status', url: URL },
      handoff: claimed,
    });
    render(
      <>
        <SharingBanner task={task} />
        <HandoffBanner task={task} />
      </>
    );
    const [sharing, handing] = screen.getAllByRole('status') as [HTMLElement, HTMLElement];
    expect(handing.textContent).toContain('Kai Lane is working on this task. It stays yours.');
    fireEvent.click(within(sharing).getByRole('button', { name: 'Manage' }));
    const shareDialog = await screen.findByRole('dialog');
    expect(within(shareDialog).getByRole('combobox', { name: 'Share as' }).textContent).toContain('Status');
    act(() => closeShareDialog());
    await waitForGone(() => screen.queryByRole('dialog'));
    fireEvent.click(within(handing).getByRole('button', { name: 'Manage' }));
    const handDialog = await screen.findByRole('dialog');
    expect(within(handDialog).getByRole('combobox', { name: 'Share as' }).textContent).toContain('Hand off');
    act(() => closeShareDialog());
    await waitForGone(() => screen.queryByRole('dialog'));
    fireEvent.click(within(handing).getByRole('button', { name: 'Remove' }));
    expect((await screen.findByRole('alertdialog')).textContent).toContain('Remove Kai Lane?');
  });

  it('copies a link no one opened yet and turns it off', async () => {
    const writeText = spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const ready = { ...HANDED, url: 'https://app.shinsa.dev/claim#x' };
    showTask({ handoff: ready });
    act(() => closeShareDialog());
    render(<HandoffBanner task={createTask({ id: 'source', handoff: ready })} />);
    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('The first GitHub account to open the hand-off link');
    fireEvent.click(within(banner).getByRole('button', { name: 'Copy hand-off link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://app.shinsa.dev/claim#x'));
    fireEvent.click(within(banner).getByRole('button', { name: 'Turn off link' }));
    await waitFor(() => expect(listSentCommands()).toEqual([{ type: 'handoff.remove', taskId: 'source' }]));
  });

  it('shows nothing on a task not handed off, or to the person it was handed to', () => {
    render(<HandoffBanner task={createTask({ id: 'source', handoff: claimed })} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
