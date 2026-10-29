import { afterEach, describe, expect, it } from 'bun:test';
import type { OnboardingFlow } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { closeSignIn } from '@/lib/connection/accounts.ts';
import { OnboardingPage } from '@/routes/onboarding.tsx';
import { createAccount, createSnapshot } from '../support/accounts.ts';
import {
  createFlow,
  createOnboardingStatus,
  createOption,
  createStep,
  startFakeOnboarding,
} from '../support/onboarding.ts';
import { pushAccounts, startFakeServer, stopFakeServer } from '../support/server.ts';

let fake: ReturnType<typeof startFakeOnboarding> | null = null;

afterEach(() => {
  act(() => closeSignIn());
  fake?.stop();
  fake = null;
  stopFakeServer();
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
    expect(screen.getByRole('navigation', { name: 'Setup, step 3 of 5' })).toBeTruthy();
    const merge = screen.getByRole('listbox', { name: 'Merging' });
    const options = within(merge).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(within(options[0] as HTMLElement).getByText('Recommended')).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Large tasks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back/ })).toBeTruthy();
  });

  it('Continue keeps the recommended choices, sending one pick per group', async () => {
    serve(createFlow(createStep()), [() => createFlow(createStep({ id: 'accounts', title: 'Accounts' }))]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Continue/ }));
    expect(await screen.findByRole('heading', { name: 'Accounts' })).toBeTruthy();
    expect(sentReplies()).toEqual([
      { type: 'answer', stepId: 'defaults', values: ['merge=squash', 'plans=yes'] },
    ]);
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
        { type: 'answer', stepId: 'defaults', values: ['merge=rebase', 'plans=no'] },
      ])
    );
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
    fireEvent.click(await screen.findByRole('tab', { name: 'Folders' }));
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

  it('lists the Claude accounts with the ones setup imported, and removes one you do not want', async () => {
    startFakeServer();
    pushAccounts(
      createSnapshot({
        accounts: [
          createAccount({ id: 'me', email: 'me@example.com', origin: 'claude' }),
          createAccount({ id: 'work', email: 'work@acme.dev', origin: 'cswap', plan: null }),
        ],
      })
    );
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': {
        answer: createFlow(
          createStep({
            id: 'accounts',
            title: 'Which Claude accounts can agents use?',
            options: [],
            imported: [{ origin: 'cswap', email: 'work@acme.dev', plan: null }],
            notes: ['claude-swap did not hand over side@acme.dev.'],
          })
        ),
      },
      'POST /api/onboarding/flow': { answer: createFlow(createStep({ id: 'prerequisites', options: [] })) },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
      'POST /api/accounts/remove': {
        answer: createSnapshot({
          accounts: [createAccount({ id: 'me', email: 'me@example.com', origin: 'claude' })],
        }),
      },
      'POST /api/accounts/login': { answer: createSnapshot() },
    });
    renderPage();
    const work = (await screen.findByText('work@acme.dev')).closest('li') as HTMLElement;
    expect(within(work).getByText('Added')).toBeTruthy();
    expect(within(work).getByText('From claude-swap')).toBeTruthy();
    expect(screen.getByText('claude-swap did not hand over side@acme.dev.')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() =>
      expect(sentReplies()).toEqual([{ type: 'answer', stepId: 'accounts', values: ['continue'] }])
    );
  });

  it('offers to sign in again or to sign in at all when no account works', async () => {
    startFakeServer();
    pushAccounts(createSnapshot({ accounts: [createAccount({ id: 'old', signIn: 'signed_out' })] }));
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': {
        answer: createFlow(createStep({ id: 'accounts', options: [], submitLabel: 'Skip for now' })),
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
    expect(screen.getByRole('button', { name: /Skip for now/ })).toBeTruthy();
    pushAccounts(createSnapshot({ accounts: [] }));
    expect(await screen.findByText('Shinsa found no Claude login on this machine.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in to Claude' })).toBeTruthy();
  });

  it('checks the tools again, finishes setup and shows what you set up with a way home', async () => {
    const tools = createStep({
      id: 'prerequisites',
      title: 'The tools Shinsa runs',
      options: [],
      ready: false,
      submitLabel: 'Finish anyway',
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
    serve(createFlow(tools), [() => createFlow(null)]);
    history.replaceState(null, '', '/onboarding');
    renderPage();
    expect(await screen.findByText('bun: not found')).toBeTruthy();
    expect(screen.getByText(/Install Bun from/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() =>
      expect(fake?.requests.filter((request) => request.path === '/api/onboarding/flow')).toHaveLength(2)
    );
    fireEvent.click(await screen.findByRole('button', { name: /Finish anyway/ }));
    expect(await screen.findByRole('heading', { name: 'Shinsa is ready' })).toBeTruthy();
    expect(screen.getByText('Accounts answer')).toBeTruthy();
    expect(location.pathname).toBe('/onboarding');
    fireEvent.click(screen.getByRole('button', { name: /Go to Home/ }));
    expect(location.pathname).toBe('/');
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

  it('a tool you install by command shows it to copy, and the tools are checked again when you come back', async () => {
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
    expect(await screen.findByText('brew install gh')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
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
