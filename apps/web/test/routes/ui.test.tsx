import { afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout, spyOn } from 'bun:test';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Root } from '@/root.tsx';
import { navigate } from '@/router.ts';
import { listSentCommands, startFakeServer, stopFakeServer } from '../support/server.ts';

const NOTHING_SENT = 'Nothing was sent. This page only shows samples.';

setDefaultTimeout(30_000);

let requests: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | null = null;

beforeAll(async () => {
  await import('@/routes/ui/index.tsx');
});

beforeEach(() => {
  startFakeServer();
  requests = spyOn(globalThis, 'fetch');
});

afterEach(() => {
  requests?.mockRestore();
  requests = null;
  stopFakeServer();
});

async function renderGallery() {
  act(() => navigate('/ui'));
  const view = render(<Root />);
  await screen.findByRole('button', { name: 'Toggle theme' }, { timeout: 15_000 });
  return view;
}

function findSection(id: string) {
  const section = document.getElementById(id);
  if (!section) throw new Error(`No section ${id}.`);
  return within(section);
}

async function expectNothingSent() {
  await waitFor(() => expect(screen.getAllByText(NOTHING_SENT).length).toBeGreaterThan(0));
  expect(listSentCommands()).toEqual([]);
  expect(requests).not.toHaveBeenCalled();
}

describe('the /ui gallery', () => {
  it('shows every overview card from sample data', async () => {
    await renderGallery();
    const overview = findSection('shinsa-overview');
    for (const text of [
      'No checks to run',
      'Resumes when the usage limit resets',
      'Paused until the usage limit resets',
      'The agent is waiting on something outside the repository',
      'The checkout test needs a Stripe test key to create a payment intent.',
      'Out of automatic fix rounds',
      'Reached its usage limit',
      'The agent’s wait ran out of checks',
      'Should the v1 endpoint stay for one more release?',
      'The agents could not settle the review',
      'The agent wants your go-ahead on this plan',
      'Suggested tasks',
      'Delegations',
      'Answered your question',
      'Wrote the report',
      'Reported the diagnosis',
      'Reported the outcome',
      'Diagnosis',
      'Working out the steps',
      'The change merged. Run the operation now?',
      'Extra checks',
      'The agent asked for your approval.',
    ]) {
      expect(overview.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(overview.getByRole('button', { name: 'Run the operation' })).toBeTruthy();
    expect(document.getElementById('shinsa-overview')?.textContent).toContain(
      'Sign in to Claude as christo@example.com'
    );
    expect(overview.getByRole('button', { name: 'Allow another 10%' })).toBeTruthy();
    expect(overview.getAllByText(/^No output for/)).toHaveLength(2);
  });

  it('shows the chat, settings and account pieces in each of their states', async () => {
    await renderGallery();
    const chat = findSection('shinsa-chat');
    for (const text of [
      'Working',
      'Waiting for its delegations',
      'Waiting for the agent that delegated it to answer',
      'Account switched',
      '· christo@example.com',
      'Conversation compacted',
      'Session restored from the transcript',
      'Conversation handed over',
      '· Codex',
    ]) {
      expect(chat.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(chat.getAllByRole('img', { name: /^Context \d+% full$/ })).toHaveLength(3);
    const settings = findSection('shinsa-settings');
    for (const text of ['Finished', 'Last run failed', 'Its task is gone', 'Play a sound']) {
      expect(settings.getByText(text)).toBeTruthy();
    }
    for (const text of [
      'Paused',
      'Needs sign-in',
      'Pro',
      'Not signed in',
      'Not installed',
      'Too old for Shinsa',
      'No usage reported yet.',
      'Add a Claude account so agents can run on it and switch when one runs out of usage.',
    ]) {
      expect(settings.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(settings.getAllByText(/^Out of usage until/).length).toBeGreaterThan(0);
    expect(settings.getByText(/^Next at/)).toBeTruthy();
    expect(settings.getAllByText(/^christo@example\.com is in your accounts twice\./).length).toBeGreaterThan(
      0
    );
    const accounts = findSection('shinsa-accounts');
    expect(accounts.getByText('Needs sign-in')).toBeTruthy();
    expect(accounts.getByText(/^Out of usage until/)).toBeTruthy();
    expect(findSection('shinsa').getByText(/^Shinsa skipped 2 damaged entries/)).toBeTruthy();
  });

  it('shows the setup and composer pieces, and lists its sections in the order they appear', async () => {
    await renderGallery();
    const shinsa = findSection('shinsa');
    expect(shinsa.getByRole('button', { name: 'Rebase' }).getAttribute('aria-pressed')).toBeNull();
    const setup = findSection('shinsa-setup');
    expect(setup.getByRole('heading', { name: 'Where do you keep your repositories?' })).toBeTruthy();
    expect(setup.getByRole('option', { name: /~\/Developer/ }).getAttribute('aria-selected')).toBe('true');
    expect(setup.getByRole('option', { name: /Squash/ }).getAttribute('aria-selected')).toBe('true');
    expect(setup.getByText('Added')).toBeTruthy();
    expect(setup.getByText('Not signed in.')).toBeTruthy();
    expect(setup.getByRole('heading', { name: 'Shinsa is ready' })).toBeTruthy();
    expect(shinsa.getByRole('button', { name: 'Remove account' })).toBeTruthy();
    for (const name of ['Project', 'When to start', 'Priority']) {
      expect(shinsa.getByRole('combobox', { name })).toBeTruthy();
    }
    const nav = [...document.querySelectorAll('nav[aria-label="Sections"] a')].map((link) =>
      link.getAttribute('href')
    );
    const page = [...document.querySelectorAll('main > section[id]')].map((section) => `#${section.id}`);
    expect(nav).toEqual(page);
  });

  it('answers every action with a toast and sends nothing, even with the connection open', async () => {
    await renderGallery();
    const overview = findSection('shinsa-overview');
    fireEvent.click(overview.getByRole('button', { name: 'Verify again' }));
    fireEvent.click(overview.getByRole('button', { name: 'Allow another 10%' }));
    fireEvent.click(overview.getByRole('button', { name: 'Sign in' }));
    const [refresh] = findSection('shinsa-settings').getAllByRole('button', { name: 'Refresh usage' });
    if (refresh) fireEvent.click(refresh);
    fireEvent.click(overview.getByRole('button', { name: 'Keep v1 for one more release Recommended' }));
    const setup = findSection('shinsa-setup');
    fireEvent.click(setup.getByRole('option', { name: /Rebase/ }));
    fireEvent.click(setup.getAllByRole('button', { name: /Back/ })[0] as HTMLElement);
    fireEvent.click(setup.getByRole('button', { name: 'Check again' }));
    fireEvent.click(setup.getByRole('button', { name: 'Add account' }));
    fireEvent.click(setup.getByRole('button', { name: /Go to Home/ }));
    fireEvent.click(
      findSection('shinsa-chat').getByRole('button', {
        name: 'Stop “Review the session cleanup” and what it delegated',
      })
    );
    await expectNothingSent();
  });

  it('opens the sign-in dialog at its code step without starting a sign-in', async () => {
    await renderGallery();
    fireEvent.click(findSection('shinsa-accounts').getByRole('button', { name: 'Sign in to Claude' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.change(dialog.getByRole('textbox', { name: 'Sign-in code' }), { target: { value: 'abc-123' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Submit code' }));
    await expectNothingSent();
  });

  it('shows the evidence panel on sample files, a note as markdown, without reading anything from Shinsa', async () => {
    await renderGallery();
    const evidence = findSection('shinsa-evidence');
    expect(evidence.getAllByText('Before')).toHaveLength(2);
    expect(evidence.getAllByText('After')).toHaveLength(2);
    expect(evidence.getByRole('cell', { name: '6.9:1' })).toBeTruthy();
    expect(evidence.getByLabelText(/Scrolling the tab group/)).toBeTruthy();
    expect(evidence.getByText('2 pass, 0 fail')).toBeTruthy();
    expect(evidence.getByText('Checks run by Shinsa: all 2 passed')).toBeTruthy();
    expect(evidence.getByText('~/.config/shinsa/data/evidence/sample/round-1')).toBeTruthy();
    expect(requests).not.toHaveBeenCalled();
  });
});
