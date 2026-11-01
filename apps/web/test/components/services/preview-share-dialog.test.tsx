import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { type PreviewShare, resolveServiceView, type Task } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PreviewShareDialog } from '@/components/services/preview-share-dialog.tsx';
import { PreviewShareButton, PreviewSharingSample } from '@/components/services/task-previews.tsx';
import { connection } from '@/lib/connection/socket.ts';
import {
  closePreviewShareDialog,
  openPreviewShareDialog,
  usePreviewShareDialog,
} from '@/lib/share/previews.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState, createTask, NOW } from '../../support/state.ts';
import { createService, createTerminal } from '../../support/terminals.ts';

const URL = 'https://abc.shinsa.page/?key=k';

const SHARING: PreviewShare = { serviceId: 'web', at: 1, url: null, limit: 'until_done', endsAt: null };

const VIEW = resolveServiceView(
  createService({ id: 'web', previewUrl: 'http://localhost:{port}/' }),
  createTerminal({ id: 'run', serviceId: 'web', taskId: 'fix', port: 4123, startedAt: 0 }),
  NOW
);

function pushTask(overrides: Partial<Task> = {}) {
  pushState(createShinsaState({ tasks: [createTask({ id: 'fix', handle: 'SH-4', ...overrides })] }));
}

function showDialog(overrides: Partial<Task> = {}, paired = true) {
  const snapshot = createRemoteSnapshot({ paired });
  spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(snapshot));
  act(() => connection.replaceRemote(snapshot));
  pushTask(overrides);
  render(<PreviewShareDialog />);
  act(() => openPreviewShareDialog({ taskId: 'fix', serviceId: 'web' }));
}

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  act(() => closePreviewShareDialog());
  stopFakeServer();
  mock.restore();
});

describe('Share preview', () => {
  it('says sharing needs remote access and opens its settings', async () => {
    showDialog({}, false);
    expect(await screen.findByText(/reaches this service through remote access/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(location.pathname).toBe('/settings');
  });

  it('shares the service for as long as you pick, and waits for the link', async () => {
    showDialog();
    expect(await screen.findByRole('combobox', { name: 'Share for' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'preview.share', taskId: 'fix', serviceId: 'web', limit: 'until_done' },
      ])
    );
    pushTask({ previews: [SHARING] });
    await waitFor(() =>
      expect(screen.getByText('Share').closest('button')?.getAttribute('aria-busy')).toBe('true')
    );
  });

  it('shows the link and when it ends, copies it, and closes when you stop sharing', async () => {
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    showDialog({ previews: [{ ...SHARING, url: URL }] });
    const link = (await screen.findByRole('textbox', { name: 'Preview link' })) as HTMLInputElement;
    expect(link.value).toBe(URL);
    expect(link.readOnly).toBe(true);
    expect(screen.getByText(/while it runs on this machine\. Sharing ends when the task is done\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL));
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'preview.unshare', taskId: 'fix', serviceId: 'web' }])
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('changes how long a shared link lasts, and closes on Done', async () => {
    showDialog({ previews: [{ ...SHARING, url: URL }] });
    fireEvent.click(await screen.findByRole('combobox', { name: 'Share for' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const item = within(screen.getAllByRole('listbox').at(-1) as HTMLElement).getByRole('option', {
      name: '1 hour',
    });
    fireEvent.pointerDown(item, { pointerType: 'mouse' });
    fireEvent.click(item);
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'preview.share', taskId: 'fix', serviceId: 'web', limit: 'hour' },
      ])
    );
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('counts down a link with a time limit', async () => {
    showDialog({ previews: [{ ...SHARING, url: URL, limit: 'hour', endsAt: Date.now() + 3_600_000 }] });
    expect(await screen.findByText(/Sharing ends in/)).toBeTruthy();
  });

  it('says why the link failed, tries again or stops', async () => {
    showDialog({ previews: [{ ...SHARING, failure: 'This machine is not paired.' }] });
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'preview.share', taskId: 'fix', serviceId: 'web', limit: 'until_done' },
      ])
    );
  });

  it('stays closed for a task it cannot find', () => {
    pushTask();
    render(<PreviewShareDialog />);
    act(() => openPreviewShareDialog({ taskId: 'gone', serviceId: 'web' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the Share preview button', () => {
  function Opened() {
    const target = usePreviewShareDialog();
    return <span>{target ? `${target.taskId} ${target.serviceId}` : 'closed'}</span>;
  }

  it('opens Share preview for the task’s service, and marks one already shared', async () => {
    pushTask();
    const view = render(
      <TooltipProvider>
        <PreviewShareButton view={VIEW} />
        <Opened />
      </TooltipProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Share preview' }));
    expect(screen.getByText('fix web')).toBeTruthy();
    pushTask({ previews: [{ ...SHARING, url: URL }] });
    expect(await screen.findByRole('button', { name: 'Sharing preview' })).toBeTruthy();
    view.unmount();
  });

  it('shows nothing for a service outside a task, or a task it cannot find', () => {
    pushTask();
    render(
      <TooltipProvider>
        <PreviewShareButton view={{ ...VIEW, taskId: null }} />
        <PreviewShareButton view={{ ...VIEW, taskId: 'gone' }} />
      </TooltipProvider>
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('asks the gallery’s sample instead of the engine', () => {
    const opened: string[] = [];
    render(
      <TooltipProvider>
        <PreviewSharingSample value={{ isShared: () => true, open: (each) => opened.push(each.service.id) }}>
          <PreviewShareButton view={{ ...VIEW, taskId: 'gone' }} />
        </PreviewSharingSample>
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sharing preview' }));
    expect(opened).toEqual(['web']);
  });
});
