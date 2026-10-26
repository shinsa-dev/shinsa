import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import type { TerminalsSnapshot } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { connection } from '@/lib/connection/socket.ts';
import { syncTerminalViews } from '@/lib/terminal/view.ts';
import { TerminalPage } from '@/routes/terminal.tsx';
import { createShinsaState } from '../support/state.ts';
import { createTerminal, createTerminalState, createTerminalsSnapshot } from '../support/terminals.ts';

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

  it('asks before closing a running terminal, and closes an ended one at once', async () => {
    visit('/terminal?project=SH&terminal=server');
    show(createTerminalsSnapshot([SERVER, ENDED]));
    answer = createTerminalsSnapshot([SERVER, ENDED]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Close terminal' })[0] as HTMLElement);
    expect(await screen.findByText('Close this terminal?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }));
    await waitFor(() => expect(readPosts().map(([url]) => url)).toContain('/api/terminals/server/close'));
    await waitFor(() => expect(location.search).toBe('?project=SH&terminal=ended'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Close terminal' })[1] as HTMLElement);
    await waitFor(() => expect(readPosts().map(([url]) => url)).toContain('/api/terminals/ended/close'));
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
