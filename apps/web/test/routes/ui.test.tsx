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

function expectNothingRequested() {
  expect(listSentCommands()).toEqual([]);
  expect(requests).not.toHaveBeenCalled();
}

async function expectNothingSent() {
  await waitFor(() => expect(screen.getAllByText(NOTHING_SENT).length).toBeGreaterThan(0));
  expectNothingRequested();
}

describe('the /ui gallery', () => {
  it('shows every overview card from sample data', async () => {
    await renderGallery();
    const overview = findSection('shinsa-overview');
    for (const text of [
      'The default branch is missing',
      /^Waiting for usage: continues at /,
      /^Waiting for usage: pauses for you at /,
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
      'Checks',
      'The agent asked for your approval.',
      'Resolving conflicts with main',
      'Resolving conflicts',
    ]) {
      expect(overview.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(overview.getByRole('button', { name: 'Run the operation' })).toBeTruthy();
    expect(document.getElementById('shinsa-overview')?.textContent).toContain(
      'Paused: christo@example.com needs signing in'
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
      'Claude was busy, trying again',
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
    const review = findSection('shinsa-review');
    const verdicts = review.getAllByRole('tablist', { name: 'Verdict' });
    expect(verdicts).toHaveLength(3);
    fireEvent.click(review.getByRole('button', { name: 'Collapse disputed' }));
    expect(review.queryByText('Kept the old keys')).toBeNull();
    const [blocking] = verdicts;
    if (!blocking) throw new Error('No verdict.');
    expect(within(blocking).getByRole('tab', { name: 'Fix' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(blocking).getByRole('tab', { name: 'Dismiss' }));
    expect(within(blocking).getByRole('tab', { name: 'Dismiss' }).getAttribute('aria-selected')).toBe('true');
    await expectNothingSent();
  });

  it('offers Run in terminal only on the code blocks marked run, and Copy on every example', async () => {
    await renderGallery();
    const shinsa = findSection('shinsa');
    const specimen = (label: RegExp) => within(shinsa.getByText(label).parentElement as HTMLElement);
    const runnable = specimen(/^CodeBlock · its corner/);
    expect(runnable.getAllByRole('button', { name: 'Run in terminal' })).toHaveLength(2);
    expect(runnable.getAllByRole('button', { name: 'Copy' })).toHaveLength(3);
    const examples = specimen(/^CodeBlock · an example/);
    expect(examples.queryByRole('button', { name: 'Run in terminal' })).toBeNull();
    expect(examples.getAllByRole('button', { name: 'Copy' })).toHaveLength(3);
    expectNothingRequested();
  });

  it('shows How to test with what the tests cover and a step to try for each kind of target, running nothing', async () => {
    await renderGallery();
    const overview = findSection('shinsa-overview');
    const panel = overview.getByText('Try it yourself').closest('section') as HTMLElement;
    expect(within(panel).getByText('Covered by tests')).toBeTruthy();
    expect(within(panel).getAllByText('You should see')).toHaveLength(4);
    expect(
      within(panel)
        .getByRole('link', { name: 'http://localhost:5173/billing/invoices' })
        .getAttribute('target')
    ).toBe('_blank');
    expect(within(panel).getByText('Billing → Invoices → the newest invoice')).toBeTruthy();
    expect(within(panel).getByText('apps/api/src/webhooks/stripe.ts')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Run in terminal' }));
    await expectNothingSent();
  });

  it('ticks the checklist samples in place and draws a Markdown task list as read-only rows', async () => {
    await renderGallery();
    const checklist = findSection('checklist');
    expect(checklist.getAllByText('1 of 3 done').length).toBeGreaterThan(0);
    fireEvent.click(checklist.getByRole('checkbox', { name: 'Publish the release notes' }));
    await waitFor(() => expect(checklist.getByText('2 of 3 done')).toBeTruthy());
    const flag = () => checklist.getByRole('checkbox', { name: 'Turn on the invoices flag' });
    expect(flag().hasAttribute('data-disabled')).toBe(true);
    fireEvent.click(checklist.getByRole('checkbox', { name: 'Run the migration' }));
    await waitFor(() => expect(flag().hasAttribute('data-disabled')).toBe(false));
    fireEvent.click(checklist.getAllByRole('button', { name: 'Run in terminal' })[0] as HTMLElement);
    expect(checklist.getAllByText('Check the upgrade notes')).toHaveLength(2);
    expect(checklist.getAllByRole('img', { name: 'Done' }).length).toBeGreaterThan(4);
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

  it('shows the Checks list in each state, a linked test, the plan’s checks and the repository setting', async () => {
    await renderGallery();
    const checks = findSection('shinsa-checks');
    for (const text of [
      'Running 2 checks',
      'All 5 passed',
      '1 of 4 failed',
      'Passed when re-run alone',
      'Already failing on main, so it does not block',
      'Added by the agent · phase 3',
      'Repository · before review',
      'test (ubuntu-latest)',
      'Covers a product with no currency in the editor and in the API.',
      'Phases 2 to 3',
      'Added the check “Webhook retry test”',
    ]) {
      expect(checks.getAllByText(text).length).toBeGreaterThan(0);
    }
    fireEvent.click(checks.getAllByRole('button', { name: 'Show the output' })[0] as HTMLElement);
    expect(await checks.findByText(/Ran 2 tests across 1 file/)).toBeTruthy();
    expect(requests).not.toHaveBeenCalled();
  });

  it('shows the evidence panel on sample files, a note as markdown, without reading anything from Shinsa', async () => {
    await renderGallery();
    const evidence = findSection('shinsa-evidence');
    expect(evidence.getAllByText('Before')).toHaveLength(2);
    expect(evidence.getAllByText('After')).toHaveLength(2);
    expect(evidence.getByRole('cell', { name: '6.9:1' })).toBeTruthy();
    expect(evidence.getByLabelText(/Scrolling the tab group/)).toBeTruthy();
    expect(evidence.getByText('Tab group tests')).toBeTruthy();
    expect(evidence.getByText('bun test src/ui/tab-group.test.tsx')).toBeTruthy();
    expect(
      evidence.getByText('Covers centring the active tab and keeping every tab at its width.')
    ).toBeTruthy();
    expect(evidence.getByText('Repository · before review')).toBeTruthy();
    expect(evidence.getByText('~/.config/shinsa/data/evidence/sample/round-1')).toBeTruthy();
    expect(requests).not.toHaveBeenCalled();
  });
});
