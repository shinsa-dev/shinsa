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

function serve(first: OnboardingFlow, replies: ((body: unknown) => OnboardingFlow)[] = []) {
  fake = startFakeOnboarding({
    'GET /api/onboarding/flow': { answer: first },
    'POST /api/onboarding/flow': { answer: (body: unknown) => replies.shift()?.(body) ?? first },
    'GET /api/onboarding': { answer: createOnboardingStatus() },
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
  it('shows one step at a time with its options, none picked, and where you are in setup', async () => {
    serve(createFlow(createStep()));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'How should pull requests be merged?' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Setup, step 3 of 6' })).toBeTruthy();
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['false', 'false']);
    expect(within(options[0] as HTMLElement).getByText('Recommended')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Back/ })).toBeTruthy();
  });

  it('answers with the option you click and moves on to the next step', async () => {
    serve(createFlow(createStep()), [
      () => createFlow(createStep({ id: 'plans', title: 'Should agents ask?' })),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole('option', { name: /Rebase/ }));
    expect(await screen.findByRole('heading', { name: 'Should agents ask?' })).toBeTruthy();
    expect(sentReplies()).toEqual([{ type: 'answer', stepId: 'merge', values: ['rebase'] }]);
  });

  it('answers from the keyboard: the arrows move through the options and Enter picks one', async () => {
    serve(createFlow(createStep()), [() => createFlow(createStep({ id: 'plans' }))]);
    renderPage();
    const list = await screen.findByRole('listbox', { name: 'How should pull requests be merged?' });
    await waitFor(() => expect(document.activeElement).toBe(list));
    fireEvent.keyDown(list, { key: 'Enter' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Tab' });
    expect(list.getAttribute('aria-activedescendant')).toMatch(/-1$/);
    fireEvent.keyDown(list, { key: 'Enter' });
    await waitFor(() =>
      expect(sentReplies()).toEqual([{ type: 'answer', stepId: 'merge', values: ['rebase'] }])
    );
  });

  it('goes back a step, shows your earlier answer picked and keeps it with Continue', async () => {
    const back = createFlow(
      createStep({
        id: 'model',
        title: 'Which model should agents use?',
        options: [createOption({ value: 'opus', label: 'Opus 5.5', chosen: true })],
      })
    );
    serve(createFlow(createStep()), [() => back, () => createFlow(createStep())]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Back/ }));
    expect(await screen.findByRole('heading', { name: 'Which model should agents use?' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Opus/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() =>
      expect(sentReplies()).toEqual([
        { type: 'open', stepId: 'model' },
        { type: 'answer', stepId: 'model', values: ['opus'] },
      ])
    );
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
        { id: 'git', label: 'Git', ok: true, detail: 'git version 2.50', fix: null },
        {
          id: 'bun',
          label: 'Bun',
          ok: false,
          detail: 'bun: not found',
          fix: 'Install Bun from https://bun.sh.',
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
    expect(await screen.findByRole('heading', { name: 'How should pull requests be merged?' })).toBeTruthy();
  });
});
