import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { Task } from '@shinsa/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShareDialog } from '@/components/task/share-dialog.tsx';
import { connection } from '@/lib/connection/socket.ts';
import { closeShareDialog, openShareDialog } from '@/lib/share/dialog.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

function showTask(overrides: Partial<Task> = {}, paired = true) {
  const snapshot = createRemoteSnapshot({ paired });
  spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(snapshot));
  act(() => connection.replaceRemote(snapshot));
  pushState(createShinsaState({ tasks: [createTask({ id: 'source', handle: 'SW-2', ...overrides })] }));
  render(<ShareDialog />);
  act(() => openShareDialog('source'));
}

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  act(() => closeShareDialog());
  stopFakeServer();
  mock.restore();
});

describe('the share dialog', () => {
  it('says sharing needs remote access, and opens its settings or the preview', async () => {
    showTask({}, false);
    expect(await screen.findByText(/sharing needs remote access/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(location.pathname).toBe('/tasks/SW-2/shared');
    act(() => openShareDialog('source'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Settings' }));
    expect(location.pathname).toBe('/settings');
  });

  it('shares the task once you ask', async () => {
    showTask();
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
    await waitFor(() => expect(listSentCommands()).toEqual([{ type: 'task.share', taskId: 'source' }]));
  });

  it('waits for the link while it is made', async () => {
    showTask({ share: { at: 1, url: null } });
    expect(await screen.findByRole('button', { name: 'Stop sharing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
  });

  it('shows the link to copy, and stops sharing', async () => {
    showTask({ share: { at: 1, url: 'https://app.shinsa.dev/share/abc' } });
    const link = (await screen.findByRole('textbox', { name: 'Share link' })) as HTMLInputElement;
    expect(link.value).toBe('https://app.shinsa.dev/share/abc');
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    await waitFor(() => expect(listSentCommands()).toEqual([{ type: 'task.unshare', taskId: 'source' }]));
  });

  it('says why publishing failed and tries again', async () => {
    showTask({ share: { at: 1, url: null, failure: 'app.shinsa.dev refused the publication.' } });
    expect((await screen.findByRole('alert')).textContent).toBe('app.shinsa.dev refused the publication.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(listSentCommands()).toEqual([{ type: 'task.share', taskId: 'source' }]));
  });
});
