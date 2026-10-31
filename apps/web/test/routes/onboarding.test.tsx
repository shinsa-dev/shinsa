import { afterEach, describe, expect, it } from 'bun:test';
import type { OnboardingFlow } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { closeSignIn } from '@/lib/connection/accounts.ts';
import { connection } from '@/lib/connection/socket.ts';
import { syncTerminalViews } from '@/lib/terminal/view.ts';
import { OnboardingPage } from '@/routes/onboarding.tsx';
import { createAccount, createProviderLogin, createSnapshot } from '../support/accounts.ts';
import {
  createFlow,
  createOnboardingStatus,
  createOption,
  createStep,
  startFakeOnboarding,
} from '../support/onboarding.ts';
import { pushAccounts, pushState, startFakeServer, stopFakeServer } from '../support/server.ts';
import { createShinsaState, createTask } from '../support/state.ts';
import { createTerminal, createTerminalsSnapshot } from '../support/terminals.ts';

class QuietSocket {
  binaryType = 'blob';
  readyState = 0;
  addEventListener() {}
  send() {}
  close() {}
}

const globals = globalThis as { WebSocket: unknown };

const realWebSocket = globals.WebSocket;

let fake: ReturnType<typeof startFakeOnboarding> | null = null;

afterEach(() => {
  act(() => closeSignIn());
  fake?.stop();
  fake = null;
  stopFakeServer();
  syncTerminalViews(new Set());
  globals.WebSocket = realWebSocket;
});

const ROOTS = createStep({
  id: 'roots',
  title: 'Where do you keep your repositories?',
  multiple: true,
  options: [
    createOption({
      value: '/Users/me/Developer',
      label: '~/Developer',
      detail: '12 repositories',
      chosen: true,
    }),
    createOption({ value: '/Users/me/oss', label: '~/oss', detail: '1 repository' }),
  ],
});

const PROJECTS = createStep({
  id: 'projects',
  title: 'Shinsa sorted your repositories into projects',
  options: [],
  submitLabel: 'Create 2 projects',
  projects: [
    {
      id: 'owner:acme',
      name: 'Acme',
      key: 'ACM',
      color: 'green',
      projectId: null,
      folders: ['/Users/me/Acme'],
      repos: [
        { path: '/Users/me/Acme/api', name: 'api' },
        { path: '/Users/me/Acme/web', name: 'web' },
      ],
    },
    {
      id: 'personal',
      name: 'Personal',
      key: 'PER',
      color: 'blue',
      projectId: null,
      folders: [],
      repos: [{ path: '/Users/me/code/notes', name: 'notes' }],
    },
  ],
});

function serve(first: OnboardingFlow, replies: ((body: unknown) => OnboardingFlow)[] = []) {
  fake = startFakeOnboarding({
    'GET /api/onboarding/flow': { answer: first },
    'POST /api/onboarding/flow': { answer: (body: unknown) => replies.shift()?.(body) ?? first },
    'GET /api/onboarding': { answer: createOnboardingStatus() },
    'POST /api/onboarding/privacy': { answer: { ok: true } },
  });
  return fake;
}

function renderPage() {
  return render(
    <TooltipProvider>
      <OnboardingPage />
    </TooltipProvider>
  );
}

function sentReplies() {
  return (fake?.requests ?? [])
    .filter((request) => request.method === 'POST' && request.path === '/api/onboarding/flow')
    .map((request) => request.body);
}

describe('the setup page', () => {
  it('shows the defaults with the recommended choice picked in each group, and where you are in setup', async () => {
    serve(createFlow(createStep()));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'How should agents work?' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Set up Shinsa' })).toBeTruthy();
    const path = screen.getByRole('navigation', { name: 'Setup, step 3 of 5' });
    expect(
      within(path)
        .getByRole('button', { name: /Defaults/ })
        .getAttribute('aria-current')
    ).toBe('step');
    expect((within(path).getByRole('button', { name: /Claude/ }) as HTMLButtonElement).disabled).toBe(true);
    const merge = screen.getByRole('listbox', { name: 'Merging' });
    const options = within(merge).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(within(options[0] as HTMLElement).getByText('Recommended')).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Plans' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back/ })).toBeTruthy();
  });

  it('Continue keeps the recommended choices, sending one pick per group', async () => {
    serve(createFlow(createStep()), [() => createFlow(createStep({ id: 'accounts', title: 'Accounts' }))]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Continue/ }));
    expect(await screen.findByRole('heading', { name: 'Accounts' })).toBeTruthy();
    expect(sentReplies()).toEqual([
      { type: 'answer', stepId: 'defaults', values: ['merge=squash', 'plans=large'] },
    ]);
  });

  it('opens on its first step without sliding, then slides the old step out while the next slides in', async () => {
    serve(createFlow(createStep()), [() => createFlow(createStep({ id: 'accounts', title: 'Accounts' }))]);
    renderPage();
    const heading = await screen.findByRole('heading', { name: 'How should agents work?' });
    expect(heading.closest('.onboarding-in')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    const next = await screen.findByRole('heading', { name: 'Accounts' });
    expect(next.closest('.onboarding-in')).not.toBeNull();
    const leaving = screen.getByText('How should agents work?').closest('.onboarding-out') as HTMLElement;
    expect(leaving.hasAttribute('inert')).toBe(true);
    fireEvent.animationEnd(leaving.firstElementChild as HTMLElement);
    expect(screen.getByText('How should agents work?')).toBeTruthy();
    fireEvent.animationEnd(leaving);
    await waitFor(() => expect(screen.queryByText('How should agents work?')).toBeNull());
  });

  it('a click changes only its own group’s pick, and nothing is sent until Continue', async () => {
    serve(createFlow(createStep()), [() => createFlow(createStep({ id: 'accounts' }))]);
    renderPage();
    fireEvent.click(await screen.findByRole('option', { name: /Rebase/ }));
    fireEvent.click(screen.getByRole('option', { name: /Start building/ }));
    expect(screen.getByRole('option', { name: /Rebase/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: /Squash/ }).getAttribute('aria-selected')).toBe('false');
    expect(sentReplies()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() =>
      expect(sentReplies()).toEqual([
        { type: 'answer', stepId: 'defaults', values: ['merge=rebase', 'plans=when_asked'] },
      ])
    );
  });

  it('the highlight rests on your pick in a pick-one list and goes back to it when the pointer leaves', async () => {
    serve(createFlow(createStep()));
    renderPage();
    const squash = await screen.findByRole('option', { name: /Squash/ });
    const rebase = screen.getByRole('option', { name: /Rebase/ });
    expect(squash.getAttribute('data-highlighted')).toBe('true');
    fireEvent.pointerMove(rebase);
    expect(rebase.getAttribute('data-highlighted')).toBe('true');
    expect(squash.getAttribute('data-highlighted')).toBeNull();
    fireEvent.pointerLeave(screen.getByRole('listbox', { name: 'Merging' }));
    expect(squash.getAttribute('data-highlighted')).toBe('true');
    expect(rebase.getAttribute('data-highlighted')).toBeNull();
  });

  it('picks from the keyboard: the arrows move through a group and Enter picks one', async () => {
    serve(createFlow(createStep()));
    renderPage();
    const list = await screen.findByRole('listbox', { name: 'Merging' });
    await waitFor(() => expect(document.activeElement).toBe(list));
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Tab' });
    expect(list.getAttribute('aria-activedescendant')).toMatch(/-1$/);
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(screen.getByRole('option', { name: /Rebase/ }).getAttribute('aria-selected')).toBe('true');
    expect(sentReplies()).toEqual([]);
  });

  it('goes back a step from the defaults', async () => {
    serve(createFlow(createStep()), [() => createFlow(PROJECTS)]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Back/ }));
    await waitFor(() => expect(sentReplies()).toEqual([{ type: 'open', stepId: 'projects' }]));
  });

  it('opens any step you already answered from the steps at the top', async () => {
    serve(createFlow(createStep()), [() => createFlow(ROOTS)]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Folders/ }));
    expect(await screen.findByRole('heading', { name: 'Where do you keep your repositories?' })).toBeTruthy();
    expect(sentReplies()).toEqual([{ type: 'open', stepId: 'roots' }]);
  });

  it('picks several folders, adds one by its path and sends them all', async () => {
    serve(createFlow(ROOTS));
    renderPage();
    fireEvent.click(await screen.findByRole('option', { name: /~\/oss/ }));
    fireEvent.click(screen.getByRole('option', { name: /~\/Developer/ }));
    const field = screen.getByRole('textbox', { name: 'Folder path' });
    fireEvent.submit(field);
    fireEvent.change(field, { target: { value: ' ~/code ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    expect(screen.getByRole('option', { name: /~\/code/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() =>
      expect(sentReplies()).toEqual([
        { type: 'answer', stepId: 'roots', values: ['/Users/me/oss', '~/code'] },
      ])
    );
  });

  it('keeps Continue off until a folder is picked, and shows why the server refused one', async () => {
    serve(
      createFlow({
        ...ROOTS,
        options: [],
        problem: '/no/such is not a folder on this machine.',
      })
    );
    renderPage();
    expect(await screen.findByText('/no/such is not a folder on this machine.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('with Claude Code missing it offers to install or copy it and no sign-in, then hides the terminal and checks again when the install ends', async () => {
    globals.WebSocket = QuietSocket;
    const missing = createStep({
      id: 'accounts',
      title: 'Sign in with Claude',
      ready: false,
      submitLabel: 'Continue',
      checks: [
        {
          id: 'claude',
          label: 'Claude Code',
          ok: false,
          detail: 'Not installed.',
          fix: 'Install Claude Code, which agents run on.',
          command: 'curl -fsSL https://claude.ai/install.sh | bash',
        },
      ],
    });
    const terminal = createTerminal({ id: 'install', projectId: 'setup', name: 'Set up Claude Code' });
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': { answer: createFlow(missing) },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
      'POST /api/onboarding/install': { answer: { terminal } },
    });
    act(() => connection.replaceTerminals(createTerminalsSnapshot([terminal])));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.queryByText('Install Claude Code, which agents run on.')).toBeNull();
    expect(screen.queryByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeNull();
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Sign in with Claude/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add account' })).toBeNull();
    await waitFor(() =>
      expect(fake?.requests.find((request) => request.path === '/api/onboarding/install')?.body).toEqual({
        id: 'claude',
      })
    );
    const reads = () =>
      fake?.requests.filter((request) => request.method === 'GET' && request.path === '/api/onboarding/flow')
        .length ?? 0;
    expect(reads()).toBe(1);
    await waitFor(() => expect(document.querySelector('.xterm')).not.toBeNull());
    act(() =>
      connection.replaceTerminals(createTerminalsSnapshot([{ ...terminal, status: 'exited', exitCode: 0 }]))
    );
    await waitFor(() => expect(reads()).toBe(2));
    expect(document.querySelector('.xterm')).toBeNull();
    expect(screen.queryByText(/The install ended/)).toBeNull();
  });

  it('lists the Claude accounts and Codex, signs in to another from Add account, and removes one you do not want', async () => {
    const codexSignedOut = createProviderLogin({
      status: 'signed_out',
      method: null,
      email: null,
      fix: 'Sign in with `codex login`.',
    });
    startFakeServer();
    pushAccounts(
      createSnapshot({
        accounts: [
          createAccount({ id: 'me', email: 'me@example.com', origin: 'claude' }),
          createAccount({ id: 'work', email: 'work@acme.dev', origin: 'cswap', plan: null }),
        ],
        providers: [codexSignedOut],
      })
    );
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': {
        answer: createFlow(
          createStep({
            id: 'accounts',
            title: 'Sign in with Claude',
            options: [],
            checks: [
              { id: 'claude', label: 'Claude Code', ok: true, detail: '2.1', fix: null, command: null },
            ],
          })
        ),
      },
      'POST /api/onboarding/flow': { answer: createFlow(createStep({ id: 'prerequisites', options: [] })) },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
      'POST /api/accounts/remove': {
        answer: createSnapshot({
          accounts: [createAccount({ id: 'me', email: 'me@example.com', origin: 'claude' })],
          providers: [codexSignedOut],
        }),
      },
      'POST /api/accounts/login': { answer: createSnapshot() },
      'POST /api/accounts/refresh': { answer: createSnapshot() },
    });
    renderPage();
    const work = (await screen.findByText('work@acme.dev')).closest('li') as HTMLElement;
    expect(within(work).queryByText('Added')).toBeNull();
    expect(within(work).getByText('From claude-swap')).toBeTruthy();
    const codex = screen.getByText('Not signed in').closest('li') as HTMLElement;
    expect(within(codex).getByText('Codex')).toBeTruthy();
    fireEvent.click(within(work).getByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove account' }));
    await waitFor(() =>
      expect(fake?.requests.find((request) => request.path === '/api/accounts/remove')?.body).toEqual({
        accountId: 'work',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    await waitFor(() =>
      expect(fake?.requests.some((request) => request.path === '/api/accounts/login')).toBe(true)
    );
    act(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() =>
      expect(fake?.requests.some((request) => request.path === '/api/accounts/refresh')).toBe(true)
    );
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() =>
      expect(sentReplies()).toEqual([{ type: 'answer', stepId: 'accounts', values: ['continue'] }])
    );
  });

  it('offers to sign in again, and with no account one Sign in with Claude and no way on', async () => {
    startFakeServer();
    pushAccounts(createSnapshot({ accounts: [createAccount({ id: 'old', signIn: 'signed_out' })] }));
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': {
        answer: createFlow(createStep({ id: 'accounts', options: [], ready: false })),
      },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
      'POST /api/accounts/login': { answer: createSnapshot() },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in again' }));
    await waitFor(() =>
      expect(fake?.requests.find((request) => request.path === '/api/accounts/login')?.body).toEqual({
        accountId: 'old',
      })
    );
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(true);
    pushAccounts(createSnapshot({ accounts: [] }));
    expect(await screen.findByText('No Claude account yet. Agents need one to work.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add account' })).toBeNull();
    expect(screen.queryByText(/claude-swap/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Claude' }));
    await waitFor(() =>
      expect(
        fake?.requests
          .filter((request) => request.path === '/api/accounts/login')
          .map((request) => request.body)
      ).toEqual([{ accountId: 'old' }, {}])
    );
  });

  it('shows each tool as one line, checks again from the icon button, and finishes only once every tool is there', async () => {
    const tools = createStep({
      id: 'prerequisites',
      title: 'The tools Shinsa runs',
      options: [],
      ready: false,
      submitLabel: 'Finish setup',
      checks: [
        { id: 'git', label: 'Git', ok: true, detail: 'git version 2.50', fix: null, command: null },
        {
          id: 'bun',
          label: 'Bun',
          ok: false,
          detail: 'bun: not found',
          fix: 'Install Bun from https://bun.sh.',
          command: 'curl -fsSL https://bun.sh/install | bash',
        },
      ],
    });
    const installed = createStep({
      ...tools,
      ready: true,
      checks: tools.checks.map((check) => ({ ...check, ok: true, detail: '1.0' })),
    });
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': { answer: () => (reads() > 1 ? createFlow(installed) : createFlow(tools)) },
      'POST /api/onboarding/flow': { answer: createFlow(null, { welcome: 'welcome-1' }) },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
    });
    const reads = () =>
      fake?.requests.filter((request) => request.path === '/api/onboarding/flow').length ?? 0;
    history.replaceState(null, '', '/onboarding');
    renderPage();
    expect(await screen.findByText('Bun')).toBeTruthy();
    expect(screen.queryByText(/Install Bun from/)).toBeNull();
    expect(screen.queryByText('curl -fsSL https://bun.sh/install | bash')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByText('git version 2.50')).toBeTruthy();
    expect(screen.queryByText('bun: not found')).toBeNull();
    expect(screen.queryByRole('button', { name: /Finish anyway/ })).toBeNull();
    expect((screen.getByRole('button', { name: /Finish setup/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Check again')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check the tools again' }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /Finish setup/ }) as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(screen.getByRole('button', { name: /Finish setup/ }));
    await waitFor(() => expect(location.pathname).toBe('/tasks/welcome-1'));
  });

  it('a folder macOS keeps private offers System Settings, checks again when you come back, or leaves it out', async () => {
    const blocked = createStep({
      ...ROOTS,
      options: ROOTS.options.map((option) => ({ ...option, chosen: true })),
      access: ['/Users/me/oss'],
    });
    serve(createFlow(blocked));
    renderPage();
    expect(await screen.findByText('macOS keeps ~/oss private')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open System Settings' }));
    await waitFor(() =>
      expect(fake?.requests.some((request) => request.path === '/api/onboarding/privacy')).toBe(true)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(sentReplies()).toHaveLength(1));
    act(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(sentReplies()).toHaveLength(2));
    fireEvent.click(screen.getByRole('option', { name: /~\/oss/ }));
    act(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(sentReplies()).toHaveLength(3));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave it out' }));
    await waitFor(() => expect(sentReplies()).toHaveLength(4));
    const both = { type: 'answer', stepId: 'roots', values: ['/Users/me/Developer', '/Users/me/oss'] };
    expect(sentReplies()).toEqual([
      both,
      both,
      both,
      { type: 'answer', stepId: 'roots', values: ['/Users/me/Developer'] },
    ]);
  });

  it('a missing tool shows a copy button and Install, and the tools are checked again when you come back', async () => {
    const tools = createStep({
      id: 'prerequisites',
      title: 'The tools Shinsa runs',
      options: [],
      ready: false,
      checks: [
        {
          id: 'gh',
          label: 'GitHub CLI',
          ok: false,
          detail: 'gh: not found',
          fix: 'Install the GitHub CLI with Homebrew.',
          command: 'brew install gh',
        },
      ],
    });
    serve(createFlow(tools));
    renderPage();
    expect(await screen.findByText('GitHub CLI')).toBeTruthy();
    expect(screen.queryByText('brew install gh')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy();
    const reads = () =>
      fake?.requests.filter((request) => request.method === 'GET' && request.path === '/api/onboarding/flow')
        .length;
    const before = reads();
    act(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(reads()).toBe((before ?? 0) + 1));
  });

  it('with several tools missing, Install all runs them in one terminal and Finish setup waits', async () => {
    const missing = (id: string, label: string, command: string) => ({
      id,
      label,
      ok: false,
      detail: 'Not installed.',
      fix: null,
      command,
    });
    const tools = createStep({
      id: 'prerequisites',
      title: 'The tools Shinsa runs',
      ready: false,
      submitLabel: 'Finish setup',
      checks: [
        missing('gh', 'GitHub CLI', 'brew install gh'),
        missing('bun', 'Bun', 'curl -fsSL https://bun.sh/install | bash'),
        { ...missing('codex', 'Codex', 'npm install -g @openai/codex'), optional: true },
      ],
    });
    startFakeServer();
    const terminal = createTerminal({ id: 'all', projectId: 'setup', name: 'Set up the missing tools' });
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': { answer: createFlow(tools) },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
      'POST /api/onboarding/install': { answer: { terminal } },
    });
    renderPage();
    expect(
      await screen.findByText(
        '2 tools are missing. Install them all in one terminal, each after the one it needs.'
      )
    ).toBeTruthy();
    const isPrimary = (button: HTMLElement) => button.className.includes('before:bg-primary');
    expect(isPrimary(screen.getByRole('button', { name: 'Install all' }))).toBe(true);
    expect(isPrimary(screen.getByRole('button', { name: /Finish setup/ }))).toBe(false);
    expect(screen.getAllByRole('button', { name: 'Install' }).some(isPrimary)).toBe(false);
    globals.WebSocket = QuietSocket;
    act(() => connection.replaceTerminals(createTerminalsSnapshot([terminal])));
    fireEvent.click(screen.getByRole('button', { name: 'Install all' }));
    await waitFor(() =>
      expect(fake?.requests.find((request) => request.path === '/api/onboarding/install')?.body).toEqual({
        all: true,
      })
    );
    await waitFor(() => expect(document.querySelector('.xterm')).not.toBeNull());
  });

  it('asks an agent for help with the failing checks, shows its reply, and runs a command from it', async () => {
    const tools = createStep({
      id: 'prerequisites',
      title: 'The tools Shinsa runs',
      ready: false,
      submitLabel: 'Finish setup',
      checks: [
        {
          id: 'gh',
          label: 'GitHub CLI',
          ok: false,
          detail: 'Not installed.',
          fix: null,
          command: 'brew install gh',
        },
      ],
    });
    startFakeServer();
    pushState(createShinsaState({ tasks: [createTask({ id: 'help-1', result: null })] }));
    const terminal = createTerminal({ id: 'fix', projectId: 'setup', name: 'Fix from the agent' });
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': { answer: createFlow(tools) },
      'POST /api/onboarding/flow': { answer: createFlow({ ...tools, help: 'help-1' }) },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
      'POST /api/onboarding/install': { answer: { terminal } },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Ask an agent for help/ }));
    expect(await screen.findByText('An agent is looking into the failing checks')).toBeTruthy();
    expect(sentReplies()).toEqual([{ type: 'help', stepId: 'prerequisites' }]);
    pushState(
      createShinsaState({
        tasks: [
          createTask({
            id: 'help-1',
            result: {
              step: 'answer',
              body: 'Install Homebrew first.\n\n```bash run\nbrew install gh\n```',
              runId: null,
              at: 1,
            },
          }),
        ],
      })
    );
    expect(await screen.findByText('Install Homebrew first.')).toBeTruthy();
    globals.WebSocket = QuietSocket;
    act(() => connection.replaceTerminals(createTerminalsSnapshot([terminal])));
    fireEvent.click(screen.getByRole('button', { name: 'Run in terminal' }));
    await waitFor(() =>
      expect(fake?.requests.find((request) => request.path === '/api/onboarding/install')?.body).toEqual({
        command: 'brew install gh',
      })
    );
    await waitFor(() => expect(document.querySelector('.xterm')).not.toBeNull());
    act(() =>
      connection.replaceTerminals(createTerminalsSnapshot([{ ...terminal, status: 'exited', exitCode: 1 }]))
    );
    expect(
      await screen.findByText('The install ended with code 1. Install it again, or ask an agent for help.')
    ).toBeTruthy();
    expect(document.querySelector('.xterm')).toBeNull();
  });

  it('lets you leave setup you started again from Settings', async () => {
    serve(createFlow(ROOTS, { revisit: true }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Close setup' }));
    expect(location.pathname).toBe('/settings');
  });

  it('offers to try again when setup cannot load', async () => {
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': { status: 500, answer: { error: { message: 'Could not start.' } } },
    });
    renderPage();
    expect(await screen.findByText('Could not start.')).toBeTruthy();
    fake.stop();
    serve(createFlow(createStep()));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(await screen.findByRole('heading', { name: 'How should agents work?' })).toBeTruthy();
  });

  it('asks for a change in words with your edits, clears the box once it is done, and shows no earlier messages', async () => {
    const revised = createStep({
      ...PROJECTS,
      projects: [
        {
          ...(PROJECTS.projects[0] as (typeof PROJECTS.projects)[number]),
          id: 'revised:0',
          name: 'Acme Corp',
        },
      ],
      conversation: [{ request: 'rename acme', reply: 'I renamed Acme to Acme Corp.' }],
      submitLabel: 'Create the project',
    });
    serve(createFlow(PROJECTS), [() => createFlow(revised)]);
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Create Personal' }));
    const box = screen.getByRole('textbox', { name: 'Change the projects' });
    expect((screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: '  rename acme ' } });
    fireEvent.submit(box);
    await waitFor(() =>
      expect(sentReplies()).toEqual([
        {
          type: 'revise',
          stepId: 'projects',
          text: 'rename acme',
          projects: [{ id: 'owner:acme', name: 'Acme', repos: ['/Users/me/Acme/api', '/Users/me/Acme/web'] }],
        },
      ])
    );
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Change the projects' }) as HTMLInputElement).value).toBe(
        ''
      )
    );
    expect(screen.queryByText('I renamed Acme to Acme Corp.')).toBeNull();
    expect(screen.queryByText('rename acme')).toBeNull();
    expect((screen.getAllByRole('textbox', { name: 'Project name' })[0] as HTMLInputElement).value).toBe(
      'Acme Corp'
    );
    expect(screen.getByRole('button', { name: /Create the project/ })).toBeTruthy();
  });

  it('keeps what you typed when the change could not be made', async () => {
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': { answer: createFlow(PROJECTS) },
      'POST /api/onboarding/flow': { status: 500, answer: { error: { code: 'x', message: 'No model.' } } },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
    });
    renderPage();
    const box = await screen.findByRole('textbox', { name: 'Change the projects' });
    fireEvent.change(box, { target: { value: 'split acme' } });
    fireEvent.submit(box);
    await waitFor(() => expect(sentReplies()).toHaveLength(1));
    await waitFor(() =>
      expect(
        (screen.getByRole('textbox', { name: 'Change the projects' }) as HTMLInputElement).disabled
      ).toBe(false)
    );
    expect((screen.getByRole('textbox', { name: 'Change the projects' }) as HTMLInputElement).value).toBe(
      'split acme'
    );
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.submit(box);
    expect(sentReplies()).toHaveLength(1);
  });

  it('going back after the projects were made lists them, and with new ones too says which are set up', async () => {
    const filed = PROJECTS.projects.map((project) => ({ ...project, projectId: project.id }));
    serve(
      createFlow(
        createStep({ ...PROJECTS, projects: [], filed, title: 'Your projects', submitLabel: 'Continue' })
      )
    );
    renderPage();
    const list = await screen.findByRole('list', { name: 'Projects already set up' });
    expect(within(list).getByText('Acme')).toBeTruthy();
    expect(within(list).getByText('2 repositories · ~/Acme · api, web')).toBeTruthy();
    expect(screen.queryByText('Already set up')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Change the projects' })).toBeNull();
    cleanup();
    serve(createFlow(createStep({ ...PROJECTS, filed: filed.slice(1) })));
    renderPage();
    expect(await screen.findByText('Already set up')).toBeTruthy();
  });

  it('creates every suggested project with one press when you change nothing', async () => {
    serve(createFlow(PROJECTS), [() => createFlow(createStep())]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Create 2 projects/ }));
    await waitFor(() =>
      expect(sentReplies()).toEqual([
        {
          type: 'answer',
          stepId: 'projects',
          values: ['continue'],
          projects: [
            { id: 'owner:acme', name: 'Acme', repos: ['/Users/me/Acme/api', '/Users/me/Acme/web'] },
            { id: 'personal', name: 'Personal', repos: ['/Users/me/code/notes'] },
          ],
        },
      ])
    );
  });

  it('sends a renamed project without the repository you left out, and skips one you untick', async () => {
    serve(createFlow(PROJECTS), [() => createFlow(createStep())]);
    renderPage();
    const [acme] = await screen.findAllByRole('textbox', { name: 'Project name' });
    fireEvent.change(acme as HTMLElement, { target: { value: 'Acme Corp' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Create Personal' }));
    const [toggle] = screen.getAllByRole('button', { name: /Repositories/ });
    fireEvent.click(toggle as HTMLElement);
    expect(screen.getByText('2 repositories · ~/Acme')).toBeTruthy();
    fireEvent.click(screen.getByText('web'));
    expect(screen.getByText('1 of 2 repositories')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep api' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep api' }));
    fireEvent.click(screen.getByRole('button', { name: /Hide/ }));
    fireEvent.click(screen.getByRole('button', { name: /Create the project/ }));
    await waitFor(() =>
      expect(sentReplies()).toEqual([
        {
          type: 'answer',
          stepId: 'projects',
          values: ['continue'],
          projects: [{ id: 'owner:acme', name: 'Acme Corp', repos: ['/Users/me/Acme/api'] }],
        },
      ])
    );
  });

  it('cannot create a project you emptied the name of, and with every project left out continues without', async () => {
    serve(createFlow(PROJECTS));
    renderPage();
    const [acme] = await screen.findAllByRole('textbox', { name: 'Project name' });
    fireEvent.change(acme as HTMLElement, { target: { value: ' ' } });
    expect(screen.getByRole('button', { name: /Create 2 projects/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Create this project' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Create Personal' }));
    expect(screen.getByRole('button', { name: /Continue without projects/ }).hasAttribute('disabled')).toBe(
      false
    );
  });

  it('with nothing to suggest it shows the step’s own Continue', async () => {
    serve(createFlow(createStep({ ...PROJECTS, projects: [], submitLabel: 'Continue' })));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Continue/ }));
    await waitFor(() =>
      expect(sentReplies()).toEqual([{ type: 'answer', stepId: 'projects', values: ['continue'] }])
    );
  });
});
