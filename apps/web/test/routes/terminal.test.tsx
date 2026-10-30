import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import type { TerminalsSnapshot } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { connection } from '@/lib/connection/socket.ts';
import { syncTerminalViews } from '@/lib/terminal/view.ts';
import { TerminalPage } from '@/routes/terminal.tsx';
import { createShinsaState } from '../support/state.ts';
import {
  createService,
  createTerminal,
  createTerminalState,
  createTerminalsSnapshot,
} from '../support/terminals.ts';
import { waitForGone } from '../support/wait.ts';

class QuietSocket {
  binaryType = 'blob';
  readyState = 0;
  addEventListener() {}
  send() {}
  close() {}
}

const globals = globalThis as { WebSocket: unknown };

const realWebSocket = globals.WebSocket;

let requests: Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

let answer: TerminalsSnapshot & { terminal?: unknown };

beforeEach(() => {
  globals.WebSocket = QuietSocket;
  answer = createTerminalsSnapshot();
  requests = spyOn(globalThis, 'fetch').mockImplementation((async () =>
    Response.json(answer)) as unknown as typeof fetch);
});

afterEach(() => {
  requests.mockRestore();
  syncTerminalViews(new Set());
  globals.WebSocket = realWebSocket;
});

function visit(path: string) {
  history.replaceState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

function show(snapshot: TerminalsSnapshot | null, state = createTerminalState()) {
  if (snapshot) act(() => connection.replaceTerminals(snapshot));
  return render(
    <TooltipProvider>
      <TerminalPage state={state} />
    </TooltipProvider>
  );
}

function readPosts() {
  return requests.mock.calls.map(([url, init]) => [String(url), JSON.parse(String(init?.body ?? 'null'))]);
}

const SERVER = createTerminal({ id: 'server', name: 'Dev server' });
const SHELL = createTerminal({ id: 'shell', title: 'fish' });
const ENDED = createTerminal({ id: 'ended', title: 'bun test', status: 'exited', exitCode: 1 });

describe('the terminal page', () => {
  it('says terminals stay on the Mac in the remote build', () => {
    import.meta.env.VITE_SHINSA_REMOTE = '1';
    show(null);
    import.meta.env.VITE_SHINSA_REMOTE = undefined;
    expect(screen.getByText('Terminals stay on your Mac')).toBeTruthy();
  });

  it('waits for the engine’s list, and asks for a project when there is none', () => {
    visit('/terminal');
    const empty = show(createTerminalsSnapshot(), createShinsaState({}));
    expect(screen.getByText('No projects yet')).toBeTruthy();
    empty.unmount();
  });

  it('offers to open a terminal in one of the project’s places', async () => {
    visit('/terminal?project=SH');
    show(createTerminalsSnapshot());
    expect(screen.getByText('No terminals in Shop')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    answer = { ...createTerminalsSnapshot([SERVER]), terminal: SERVER };
    fireEvent.click(screen.getByRole('button', { name: 'Open a terminal' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'web' }));
    await waitFor(() => expect(location.search).toBe('?project=SH&terminal=server'));
    expect(readPosts()[0]).toEqual([
      '/api/terminals',
      { projectId: 'shop', path: '/Users/you/Developer/web' },
    ]);
  });

  it('shows a tab per terminal, the one the URL names in front, and switches on a click', async () => {
    visit('/terminal?project=SH&terminal=shell');
    show(createTerminalsSnapshot([SERVER, SHELL, createTerminal({ id: 'docs', projectId: 'docs' })]));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Dev server', 'fish']);
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tabs[0] as HTMLElement);
    await waitFor(() => expect(location.search).toBe('?project=SH&terminal=server'));
  });

  it('asks before closing a terminal with a program in front, and closes an idle or ended one at once', async () => {
    visit('/terminal?project=SH&terminal=server');
    show(createTerminalsSnapshot([SERVER, SHELL, ENDED]));
    answer = { ...createTerminalsSnapshot([SERVER, SHELL, ENDED]), program: 'vim' } as typeof answer;
    fireEvent.click(screen.getAllByRole('button', { name: 'Close terminal' })[0] as HTMLElement);
    expect(await screen.findByText('Close this terminal?')).toBeTruthy();
    expect(screen.getByText(/vim is still running in “Dev server”/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }));
    await waitFor(() => expect(readPosts().map(([url]) => url)).toContain('/api/terminals/server/close'));
    await waitFor(() => expect(location.search).toBe('?project=SH&terminal=shell'));
    answer = { ...createTerminalsSnapshot([SERVER, SHELL, ENDED]), program: null } as typeof answer;
    fireEvent.click(screen.getAllByRole('button', { name: 'Close terminal' })[1] as HTMLElement);
    await waitFor(() => expect(readPosts().map(([url]) => url)).toContain('/api/terminals/shell/close'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Close terminal' })[2] as HTMLElement);
    await waitFor(() => expect(readPosts().map(([url]) => url)).toContain('/api/terminals/ended/close'));
    expect(readPosts().filter(([url]) => url.endsWith('/foreground'))).toHaveLength(2);
  });

  it('marks a service’s tab, runs it from the toolbar and asks before stopping it to close its tab', async () => {
    const service = createService({ id: 'api' });
    const terminal = createTerminal({ id: 'svc', name: 'api', serviceId: 'api', startedAt: 0 });
    visit('/terminal?project=SH&terminal=svc');
    show(createTerminalsSnapshot([terminal], [service]));
    answer = { ...createTerminalsSnapshot([terminal], [service]), terminal };
    fireEvent.click(screen.getByRole('button', { name: 'Restart api' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop api' }));
    await waitFor(() =>
      expect(readPosts().map(([url]) => url)).toEqual(['/api/services/api/restart', '/api/services/api/stop'])
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }));
    expect(await screen.findByText('Stop api?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop and close' }));
    await waitFor(() => expect(readPosts().map(([url]) => url)).toContain('/api/terminals/svc/close'));
  });

  it('fills the state glyph of the service tab in front, and keeps the others outlined', () => {
    const services = [createService({ id: 'api' }), createService({ id: 'web' })];
    const terminals = ['api', 'web'].map((id) =>
      createTerminal({ id: `t-${id}`, name: id, serviceId: id, startedAt: 0 })
    );
    visit('/terminal?project=SH&terminal=t-api');
    show(createTerminalsSnapshot(terminals, services));
    const glyph = (name: 'IconPlay' | 'IconPlayFilled') =>
      render(<Icon name={name} size='sm' />).container.querySelector('svg')?.innerHTML;
    const [api, web] = screen.getAllByRole('tab').map((tab) => tab.querySelector('svg')?.innerHTML);
    expect(api).toBe(glyph('IconPlayFilled'));
    expect(web).toBe(glyph('IconPlay'));
  });

  it('starts a stopped service again from the bar under its output', async () => {
    const service = createService({ id: 'api' });
    const terminal = createTerminal({
      id: 'svc',
      name: 'api',
      serviceId: 'api',
      status: 'exited',
      exitCode: 1,
    });
    visit('/terminal?project=SH&terminal=svc');
    show(createTerminalsSnapshot([terminal], [service]));
    answer = { ...createTerminalsSnapshot([terminal], [service]), terminal };
    expect(screen.getByText('api exited with code 1.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    await waitFor(() => expect(readPosts()[0]?.[0]).toBe('/api/services/api/start'));
    fireEvent.click(screen.getByRole('button', { name: 'Start api' }));
    await waitFor(() => expect(readPosts()[1]?.[0]).toBe('/api/services/api/start'));
  });

  it('starts all the project’s stopped services from the toolbar while a shell or no tab is in front', async () => {
    const services = [createService({ id: 'api' }), createService({ id: 'web' })];
    visit('/terminal?project=SH&terminal=shell');
    const page = show(createTerminalsSnapshot([SHELL], services));
    expect(screen.queryByRole('button', { name: 'Start api' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start all services in Shop' }));
    await waitFor(() => expect(readPosts()[0]).toEqual(['/api/services/start-all', { projectId: 'shop' }]));
    page.unmount();
    visit('/terminal?project=SH');
    show(createTerminalsSnapshot([], services));
    expect(screen.queryByRole('button', { name: 'Start api' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start all services in Shop' })).toBeTruthy();
  });

  it('shows the page of the project you pick and closes the picker', async () => {
    visit('/terminal?project=SH');
    show(createTerminalsSnapshot([SERVER, createTerminal({ id: 'docs', projectId: 'docs' })]));
    fireEvent.click(screen.getByRole('button', { name: /Shop/ }));
    const docs = await screen.findByRole('menuitemradio', { name: 'Docs' });
    fireEvent.click(docs);
    await waitFor(() => expect(location.search).toBe('?project=DO'));
    await waitForGone(() => screen.queryByRole('menu'));
  });

  it('opens a new tab where the one in front is with ⌘T, and closes it with ⌘W', async () => {
    const platform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
    visit('/terminal?project=SH&terminal=ended');
    show(createTerminalsSnapshot([ENDED]));
    answer = { ...createTerminalsSnapshot([ENDED, SERVER]), terminal: SERVER };
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true }));
    await waitFor(() =>
      expect(readPosts()[0]).toEqual([
        '/api/terminals',
        { projectId: 'shop', path: '/Users/you/Developer/web' },
      ])
    );
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', metaKey: true }));
    await waitFor(() =>
      expect(readPosts().map(([url]) => url)).toContain('/api/terminals/server/foreground')
    );
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => platform });
  });

  it('starts an ended shell again from the bar under it', async () => {
    visit('/terminal?project=SH&terminal=ended');
    show(createTerminalsSnapshot([ENDED]));
    answer = createTerminalsSnapshot([ENDED]);
    expect(screen.getByText('The shell exited with code 1.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    await waitFor(() => expect(readPosts()[0]?.[0]).toBe('/api/terminals/ended/restart'));
  });

  it('renames a tab you double-click, and keeps the name when you press Escape', async () => {
    visit('/terminal?project=SH&terminal=server');
    show(createTerminalsSnapshot([SERVER]));
    answer = createTerminalsSnapshot([SERVER]);
    fireEvent.doubleClick(screen.getByRole('tab'));
    const field = screen.getByRole('textbox', { name: 'Terminal name' });
    fireEvent.change(field, { target: { value: 'Web server' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() =>
      expect(readPosts()[0]).toEqual(['/api/terminals/server/rename', { name: 'Web server' }])
    );
    fireEvent.doubleClick(screen.getByRole('tab'));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Terminal name' }), { key: 'Escape' });
    await waitFor(() =>
      expect(readPosts()[1]).toEqual(['/api/terminals/server/rename', { name: 'Dev server' }])
    );
  });

  it('moves a dragged tab to where it is dropped', async () => {
    visit('/terminal?project=SH&terminal=server');
    show(createTerminalsSnapshot([SERVER, SHELL]));
    answer = createTerminalsSnapshot([SERVER, SHELL]);
    const [first, second] = screen.getAllByRole('tab') as HTMLElement[];
    fireEvent.dragStart(first as HTMLElement, { dataTransfer: { effectAllowed: '' } });
    fireEvent.dragOver(second as HTMLElement);
    fireEvent.drop(second as HTMLElement);
    await waitFor(() =>
      expect(readPosts()[0]).toEqual([
        '/api/terminals/order',
        { projectId: 'shop', ids: ['shell', 'server'] },
      ])
    );
  });
});
