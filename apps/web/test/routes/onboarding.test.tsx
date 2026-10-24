import { afterEach, describe, expect, it } from 'bun:test';
import type { OnboardingChat } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OnboardingPage } from '@/routes/onboarding.tsx';
import {
  createChat,
  createMessage,
  createOnboardingStatus,
  createPrompt,
  startFakeOnboarding,
} from '../support/onboarding.ts';

let fake: ReturnType<typeof startFakeOnboarding> | null = null;

afterEach(() => {
  fake?.stop();
  fake = null;
});

const ROOTS_PROMPT = createPrompt({
  questionId: 'roots',
  step: 1,
  multiple: true,
  submitLabel: 'Use these folders',
  placeholder: 'Pick folders or type their paths',
  choices: [
    { value: '/Users/me/Developer', label: '~/Developer', detail: '12 repositories', chosen: false },
    { value: '/Users/me/oss', label: '~/oss', detail: '1 repository', chosen: true },
  ],
});

function serve(first: OnboardingChat, replies: ((body: unknown) => OnboardingChat)[] = []) {
  fake = startFakeOnboarding({
    'GET /api/onboarding/chat': { answer: first },
    'POST /api/onboarding/chat': { answer: (body: unknown) => replies.shift()?.(body) ?? first },
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
  return (fake?.requests ?? []).filter((request) => request.method === 'POST').map((request) => request.body);
}

describe('the setup page', () => {
  it('resumes the saved conversation: your answers, the question and its options, none picked yet', async () => {
    serve(
      createChat(createPrompt(), [
        createMessage({ text: "Let's set up Shinsa." }),
        createMessage({ text: 'Which model should agents use by default?' }),
        createMessage({ from: 'you', text: 'Opus 5.5' }),
        createMessage({ text: 'How should Shinsa merge a pull request once you approve the merge?' }),
      ])
    );
    renderPage();
    expect(await screen.findByText('Question 3 of 6')).toBeTruthy();
    expect(screen.getByText('Opus 5.5')).toBeTruthy();
    expect(
      screen.getByText('How should Shinsa merge a pull request once you approve the merge?')
    ).toBeTruthy();
    for (const name of ['Squash', 'Rebase']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBeNull();
    }
    expect(screen.getByRole('textbox', { name: 'Pick an option or answer in your own words' })).toBeTruthy();
  });

  it('sends the option you click and shows the next question', async () => {
    serve(createChat(createPrompt()), [
      () =>
        createChat(createPrompt({ questionId: 'plans', step: 4, choices: [] }), [
          createMessage({ from: 'you', text: 'Rebase' }),
          createMessage({ text: 'Should agents ask you to approve a plan before they build a large task?' }),
        ]),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Rebase' }));
    expect(await screen.findByText('Question 4 of 6')).toBeTruthy();
    expect(sentReplies()).toEqual([{ type: 'choose', questionId: 'merge', values: ['rebase'] }]);
  });

  it('picks several folders before sending them', async () => {
    serve(createChat(ROOTS_PROMPT));
    renderPage();
    const submit = await screen.findByRole('button', { name: 'Use these folders' });
    fireEvent.click(screen.getByRole('button', { name: /~\/oss/ }));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /~\/Developer/ }));
    const picked = screen.getByRole('button', { name: /~\/Developer/ });
    expect(picked.getAttribute('aria-pressed')).toBe('true');
    expect(within(picked).queryByLabelText('Selected')).toBeNull();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(sentReplies()).toEqual([
        { type: 'choose', questionId: 'roots', values: ['/Users/me/Developer'] },
      ])
    );
  });

  it('sends a typed answer, then shows the echo to confirm', async () => {
    serve(createChat(createPrompt()), [
      () =>
        createChat(
          createPrompt({
            mode: 'confirm',
            choices: [
              { value: 'yes', label: 'Yes', detail: null, chosen: false },
              { value: 'no', label: 'No, ask again', detail: null, chosen: false },
            ],
          }),
          [
            createMessage({ from: 'you', text: 'keep the history linear' }),
            createMessage({
              text: 'Pull requests are rebased onto the default branch when you merge them. Is that right?',
            }),
          ]
        ),
    ]);
    renderPage();
    const field = await screen.findByRole('textbox', { name: 'Pick an option or answer in your own words' });
    fireEvent.change(field, { target: { value: 'keep the history linear' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await screen.findByRole('button', { name: 'No, ask again' })).toBeTruthy();
    expect(screen.getByText(/rebased onto the default branch/)).toBeTruthy();
    expect(sentReplies()).toEqual([{ type: 'say', questionId: 'merge', text: 'keep the history linear' }]);
  });

  it('shows a reading problem in red with the options still there, and the checks with their fixes', async () => {
    serve(
      createChat(createPrompt({ questionId: 'prerequisites', step: 6 }), [
        createMessage({
          text: 'Last, the tools Shinsa runs on this machine.',
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
        }),
        createMessage({
          problem: true,
          text: 'I could not read that answer just now. Pick one of the options or answer again.',
        }),
      ])
    );
    renderPage();
    expect(
      await screen.findByText(
        'I could not read that answer just now. Pick one of the options or answer again.'
      )
    ).toBeTruthy();
    expect(screen.getByText('bun: not found')).toBeTruthy();
    expect(screen.getByText(/Install Bun from/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rebase' })).toBeTruthy();
  });

  it('ends with a way home once setup is done', async () => {
    serve(createChat(createPrompt({ questionId: 'prerequisites', step: 6 })), [
      () => createChat(null, [createMessage({ text: 'Setup is done.' })]),
    ]);
    history.replaceState(null, '', '/onboarding');
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Rebase' }));
    expect(await screen.findByText('Setup is done.', { selector: 'p.text-xs' })).toBeTruthy();
    expect(location.pathname).toBe('/onboarding');
    fireEvent.click(screen.getByRole('button', { name: 'Go to Home' }));
    expect(location.pathname).toBe('/');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('offers to try again when the chat cannot load', async () => {
    fake = startFakeOnboarding({
      'GET /api/onboarding/chat': { status: 500, answer: { error: { message: 'Could not start.' } } },
    });
    renderPage();
    expect(await screen.findByText('Could not start.')).toBeTruthy();
    fake.stop();
    serve(createChat(createPrompt()));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(await screen.findByText('Question 3 of 6')).toBeTruthy();
  });
});
