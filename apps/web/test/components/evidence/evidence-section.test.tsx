import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { Evidence, Task } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EVIDENCE_EMPTY, EvidenceSection } from '@/components/evidence/evidence-section.tsx';
import { refreshHealth } from '@/lib/connection/health.ts';
import { connection } from '@/lib/connection/socket.ts';
import { FakeIntersectionObserver, installIntersectionObserver } from '../../support/intersection.ts';
import { createEvidence, createRun, createShinsaState, createTask, NOW } from '../../support/state.ts';
import {
  createService,
  createTerminal,
  createTerminalState,
  createTerminalsSnapshot,
} from '../../support/terminals.ts';

const realFetch = globalThis.fetch;

const STORED = '/api/evidence/t/round-1';

function piece(id: string, overrides: Partial<Evidence>) {
  return createEvidence({
    id,
    taskId: 't',
    runId: 'build',
    uri: `${STORED}/${id}.png`,
    attachedAt: NOW,
    ...overrides,
  });
}

function answer(routes: Record<string, unknown>) {
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input);
    const body = routes[url];
    if (body === undefined) return new Response('missing', { status: 404 });
    return typeof body === 'string' ? new Response(body) : Response.json(body);
  }) as unknown as typeof globalThis.fetch;
}

function renderSection(evidence: Evidence[], showEmpty = false) {
  const state = createShinsaState({
    evidence,
    runs: [
      createRun({ id: 'build', taskId: 't' }),
      createRun({ id: 'review', taskId: 't', role: 'reviewer' }),
    ],
  });
  return render(
    <TooltipProvider>
      <EvidenceSection state={state} task={createTask({ id: 't' })} showEmpty={showEmpty} />
    </TooltipProvider>
  );
}

afterEach(() => {
  globalThis.fetch = realFetch;
  connection.replaceTerminals(createTerminalsSnapshot());
});

describe('the Evidence section', () => {
  it('shows nothing without evidence, or says so where evidence is expected', () => {
    expect(renderSection([]).container.textContent).toBe('');
    const empty = renderSection([], true);
    expect(empty.getByText(EVIDENCE_EMPTY)).toBeTruthy();
  });

  it('shows a before and its after side by side, opens them in the viewer and steps between them', async () => {
    answer({ '/api/health': { ok: true, seq: 1, problems: [], dataDir: '/Users/ada/.config/shinsa/data' } });
    await refreshHealth();
    renderSection([
      piece('before', { title: 'Settings', width: 1280, theme: 'dark', stage: 'before' }),
      piece('after', {
        title: 'Settings',
        width: 1280,
        theme: 'dark',
        stage: 'after',
        detail: 'The labels read clearly.',
        runId: 'review',
      }),
      piece('menu', { title: 'Menu', theme: 'light' }),
    ]);
    expect(screen.getByRole('heading', { name: 'Comparison' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Screenshot' })).toBeTruthy();
    const pair = screen.getByRole('heading', { name: /Settings/ }).closest('section') as HTMLElement;
    expect(within(pair).getByText('1280px · Dark')).toBeTruthy();
    expect(within(pair).getByText('Before')).toBeTruthy();
    expect(within(pair).getByText('After')).toBeTruthy();
    expect(within(pair).getByText('From the agent review')).toBeTruthy();
    expect(within(pair).getByText('The labels read clearly.')).toBeTruthy();
    expect(screen.getByText('Light')).toBeTruthy();
    expect(screen.getByText('~/.config/shinsa/data/evidence/t/round-1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings · 1280px · Dark · Before' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Settings · 1280px · Dark')).toBeTruthy();
    expect(within(dialog).getByText('1 of 2')).toBeTruthy();
    const after = within(dialog).getByRole('tab', { name: 'After' });
    fireEvent.click(after);
    await waitFor(() => expect(after.getAttribute('aria-selected')).toBe('true'));
    expect(within(dialog).getByText('1 of 2')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(await within(dialog).findByText('2 of 2')).toBeTruthy();
    expect(within(dialog).queryByRole('tab', { name: 'After' })).toBeNull();
  });

  it('shows a comparison an agent attached as one item, with a part per state', () => {
    renderSection([
      piece('empty', { title: 'Inbox', itemId: 'inbox', label: 'Empty' }),
      piece('loading', { title: 'Inbox', itemId: 'inbox', label: 'Loading' }),
      piece('full', { title: 'Inbox', itemId: 'inbox', label: 'Full' }),
    ]);
    const item = screen.getByRole('heading', { name: 'Inbox' }).closest('section') as HTMLElement;
    expect(['Empty', 'Loading', 'Full'].map((name) => within(item).getByText(name))).toHaveLength(3);
    expect(screen.queryByRole('heading', { name: 'Screenshot' })).toBeNull();
  });

  it('loads a screenshot lazily and mounts a recording only once it comes near the screen', () => {
    const restore = installIntersectionObserver();
    try {
      renderSection([
        piece('clip', { kind: 'recording', title: 'Scrolling the tabs', uri: `${STORED}/clip.webm` }),
        piece('shot', { title: 'Tabs' }),
      ]);
      expect(screen.getByRole('img', { name: 'Tabs' }).getAttribute('loading')).toBe('lazy');
      const thumbnail = screen.getByRole('button', { name: 'Play Scrolling the tabs' });
      expect(thumbnail.querySelector('video')).toBeNull();
      act(() => FakeIntersectionObserver.report(true));
      expect(thumbnail.querySelector('video')?.getAttribute('src')).toBe(`${STORED}/clip.webm`);
    } finally {
      restore();
    }
  });

  it('opens a recording in the viewer, playing, and closes it again', async () => {
    renderSection([
      piece('clip', { kind: 'recording', title: 'Scrolling the tabs', uri: `${STORED}/clip.webm` }),
      piece('shot', { title: 'Tabs' }),
    ]);
    expect(screen.getByText('Scrolling the tabs')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play Scrolling the tabs' }));
    const dialog = await screen.findByRole('dialog');
    const probe = dialog.querySelector('video') as HTMLVideoElement;
    expect(probe.controls).toBe(false);
    Object.defineProperty(probe, 'videoWidth', { value: 640 });
    Object.defineProperty(probe, 'videoHeight', { value: 400 });
    fireEvent.loadedMetadata(probe);
    fireEvent.loadedMetadata(probe);
    const video = dialog.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe(`${STORED}/clip.webm`);
    expect(video.autoplay).toBe(true);
    expect(video.controls).toBe(true);
    expect(video.style.width).toBe('640px');
    fireEvent.wheel(dialog, { deltaY: -100 });
    fireEvent.keyDown(dialog, { key: '+' });
    expect(video.style.width).toBe('640px');
    expect(within(dialog).getByText('1 of 2')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(await within(dialog).findByText('2 of 2')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous' }));
    expect(await within(dialog).findByText('1 of 2')).toBeTruthy();
  });

  it('shows a test or check run as its commands and outcomes, with the output behind a toggle', async () => {
    answer({
      [`${STORED}/tests.txt`]: 'bun test src/ui\n 3 pass\n 0 fail\n',
      [`${STORED}/checks.txt`]: '$ bun run lint\nPassed.\n\n$ bun run test\nFailed.\nexpected 2',
      [`${STORED}/odd.txt`]: '',
    });
    const view = renderSection([
      piece('tests', {
        kind: 'test',
        title: 'bun test src/ui',
        uri: `${STORED}/tests.txt`,
        detail: 'After the fix.',
      }),
      piece('checks', {
        kind: 'check',
        title: 'Checks run by Shinsa: 1 of 2 failed',
        uri: `${STORED}/checks.txt`,
      }),
      piece('odd', { kind: 'test', title: 'Nothing ran', uri: `${STORED}/odd.txt` }),
    ]);
    expect(await screen.findByText('3 pass, 0 fail')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tests 2' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Check' })).toBeTruthy();
    expect(screen.getByText('After the fix.')).toBeTruthy();
    expect(await screen.findByText('bun run lint')).toBeTruthy();
    expect(screen.getByText('Passed')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(view.container.textContent).not.toContain('expected 2');
    expect(screen.queryByRole('link', { name: /Open the file/ })).toBeNull();
    const toggles = screen.getAllByRole('button', { name: 'Show the output' });
    expect(toggles).toHaveLength(2);
    fireEvent.click(toggles[1] as HTMLElement);
    expect(view.container.textContent).toContain('expected 2');
    expect(screen.getByRole('button', { name: 'Hide the output' }).getAttribute('aria-expanded')).toBe(
      'true'
    );
    view.unmount();
    const again = renderSection([
      piece('checks', {
        kind: 'check',
        title: 'Checks run by Shinsa: 1 of 2 failed',
        uri: `${STORED}/checks.txt`,
      }),
    ]);
    expect(await screen.findByRole('button', { name: 'Hide the output' })).toBeTruthy();
    expect(again.container.textContent).toContain('expected 2');
  });

  it('shows a linked test as its check, with the agent’s note and Shinsa’s latest output, never as text of its own', async () => {
    answer({ [`${STORED}/c1.txt`]: ' 4 pass\n 0 fail' });
    const task = createTask({
      id: 't',
      checks: [
        { id: 'c1', label: 'Cart tests', command: 'bun test cart.test.ts', phases: [1], source: 'plan' },
      ],
      checkResults: [
        { id: 'c1', label: 'Cart tests', command: 'bun test cart.test.ts', outcome: 'pass', detail: null },
      ],
    });
    const state = createShinsaState({
      tasks: [task],
      evidence: [
        piece('link', {
          kind: 'test',
          title: 'Cart tests',
          uri: 'shinsa://check/c1',
          checkId: 'c1',
          detail: 'Covers the empty cart.',
          runId: 'review',
        }),
        piece('out', {
          kind: 'check',
          title: 'Cart tests',
          uri: `${STORED}/c1.txt`,
          checkId: 'c1',
          runId: null,
        }),
        piece('gone', {
          kind: 'check',
          title: 'Old tests',
          uri: `${STORED}/c9.txt`,
          checkId: 'c9',
          runId: null,
        }),
      ],
      runs: [createRun({ id: 'review', taskId: 't', role: 'reviewer' })],
    });
    const view = render(
      <TooltipProvider>
        <EvidenceSection state={state} task={task} />
      </TooltipProvider>
    );
    expect(screen.getByRole('heading', { name: 'Test' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Check' })).toBeTruthy();
    expect(screen.getByText('bun test cart.test.ts')).toBeTruthy();
    expect(screen.getByText('Covers the empty cart.')).toBeTruthy();
    expect(screen.getByText('No longer one of the task’s checks')).toBeTruthy();
    expect(view.container.querySelector('a[href^="shinsa:"]')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Show the output' })[0] as HTMLElement);
    await waitFor(() => expect(view.container.textContent).toContain('4 pass'));
  });

  it('renders a note as markdown, a file reference as its label off a task page, and lists links', async () => {
    answer({
      [`${STORED}/note.md`]:
        'Measured by **hand** in [theme.css](shinsa://file/src/theme.css#L2-L4).\n\n| Token | After |\n| --- | --- |\n| Hint | 6.9:1 |\n',
    });
    const view = renderSection([
      piece('note', { kind: 'note', title: 'Why', uri: `${STORED}/note.md` }),
      piece('preview', { kind: 'preview', title: 'Preview', uri: 'https://preview.dev' }),
    ]);
    expect(screen.getByRole('heading', { name: 'Note' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Preview' })).toBeTruthy();
    await waitFor(() => expect(view.container.textContent).toContain('Measured by hand in'));
    expect(screen.getByText('hand').tagName).toBe('STRONG');
    expect(within(screen.getByRole('table')).getByRole('cell', { name: '6.9:1' })).toBeTruthy();
    expect(view.container.querySelector('a[href^="shinsa:"]')).toBeNull();
    expect(view.container.querySelector('pre')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show the output' })).toBeNull();
    expect(screen.getByRole('link', { name: /Preview/ }).getAttribute('href')).toBe('https://preview.dev');
  });

  it('files a piece under its kind whatever its file is', () => {
    answer({});
    renderSection([piece('look', { kind: 'preview', title: 'Look', uri: `${STORED}/look.txt` })]);
    expect(screen.getByText('Look')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Preview' })).toBeTruthy();
    expect(screen.queryByText('Test')).toBeNull();
  });
});

describe('evidence brought up to date', () => {
  it('shows the current version marked as updated, and the earlier ones folded under Earlier versions', () => {
    renderSection([
      piece('before', { title: 'Settings', stage: 'before' }),
      piece('old', { title: 'Settings', stage: 'after', replacedBy: 'new' }),
      piece('new', { title: 'Settings', stage: 'after', fixFor: 'you' }),
      piece('menu', { title: 'Menu', removedAt: NOW, removedReason: 'The menu is gone.' }),
    ]);
    const pair = screen.getByRole('heading', { name: /Settings/ }).closest('section') as HTMLElement;
    expect(within(pair).getByText('Updated after your review')).toBeTruthy();
    expect(screen.queryByText('Menu')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Expand Earlier versions' });
    expect(toggle.textContent).toBe('Earlier versions2');
    fireEvent.click(toggle);
    expect(screen.getByText('Replaced by a later version')).toBeTruthy();
    expect(screen.getByText('Removed: The menu is gone.')).toBeTruthy();
    expect(screen.getByText('Menu')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Earlier versions' }));
    expect(screen.queryByText('Menu')).toBeNull();
  });

  it('says the evidence was removed when nothing current is left, and still shows the earlier versions', () => {
    renderSection([piece('menu', { title: 'Menu', removedAt: NOW, removedReason: 'Gone.' })]);
    expect(screen.getByText('The agents removed the evidence they attached this round.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expand Earlier versions' })).toBeTruthy();
  });
});

describe('the task’s running services in the Evidence section', () => {
  function runWeb(port: number) {
    const web = createService({
      id: 'web',
      cwd: '/Users/you/Developer/web',
      previewUrl: 'http://localhost:{port}/',
    });
    connection.replaceTerminals(
      createTerminalsSnapshot([createTerminal({ id: 'run', serviceId: 'web', taskId: 'fix', port })], [web])
    );
  }

  function renderTaskSection(evidence: Evidence[]) {
    const attached = createShinsaState({
      evidence: evidence.map((each) => ({ ...each, taskId: 'fix' })),
      runs: [createRun({ id: 'build', taskId: 'fix' })],
    });
    const state = { ...createTerminalState(), evidence: attached.evidence, runs: attached.runs };
    return render(
      <TooltipProvider>
        <EvidenceSection state={state} task={state.tasks.fix as Task} />
      </TooltipProvider>
    );
  }

  it('links each running preview of the task under Preview, even before any evidence is attached', () => {
    const state = createTerminalState();
    runWeb(4123);
    render(
      <TooltipProvider>
        <EvidenceSection state={state} task={state.tasks.fix as Task} />
      </TooltipProvider>
    );
    expect(screen.getByText('Preview')).toBeTruthy();
    expect(screen.getByText('web').closest('a')?.getAttribute('href')).toBe('http://localhost:4123/');
    expect(screen.getByText(EVIDENCE_EMPTY)).toBeTruthy();
  });

  it('puts a running preview in the agent’s Previews, after the ones it attached', () => {
    runWeb(4123);
    renderTaskSection([piece('remote', { kind: 'preview', title: 'Remote', uri: 'https://preview.dev' })]);
    const label = screen.getByText('Previews');
    const section = label.closest('section') as HTMLElement;
    const links = within(section).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://preview.dev',
      'http://localhost:4123/',
    ]);
  });

  it('leaves out a running preview the agent attached already, path and all', () => {
    runWeb(4123);
    renderTaskSection([
      piece('local', { kind: 'preview', title: 'Editor', uri: 'http://localhost:4123/editor' }),
    ]);
    expect(screen.getByText('Preview')).toBeTruthy();
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).not.toContain(
      'http://localhost:4123/'
    );
  });
});
