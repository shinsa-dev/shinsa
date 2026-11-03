import { describe, expect, it } from 'bun:test';
import { type Changelog, resolveEngineInfo } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ChangelogDialog, WhatsNewButton } from '@/components/changelog/dialog.tsx';
import { CHANGELOG_SEEN_KEY, closeChangelog, openChangelog, selectSeenVersion } from '@/lib/changelog.ts';
import { spyOnEngine } from '../../support/engine.ts';
import { answerFetch } from '../../support/fetch-fake.ts';
import { waitForGone } from '../../support/wait.ts';

const CHANGELOG: Changelog = {
  releases: [
    {
      version: '1.3.0',
      date: '2026-11-02',
      changes: [
        { slug: 'queue-order', kind: 'fixed', text: 'The queue keeps its order after a restart.' },
        { slug: 'whats-new', kind: 'added', text: 'Shinsa shows what changed after an update.' },
      ],
    },
    {
      version: '1.2.0',
      date: '2026-10-01',
      changes: [{ slug: 'faster-chat', kind: 'improved', text: 'Long chats open faster.' }],
    },
  ],
};

function renderShell() {
  return render(
    <TooltipProvider>
      <WhatsNewButton />
      <ChangelogDialog />
    </TooltipProvider>
  );
}

describe('What’s new', () => {
  it('shows a button after an update that opens what changed since and then goes away', async () => {
    localStorage.setItem(CHANGELOG_SEEN_KEY, '1.2.0');
    spyOnEngine(resolveEngineInfo('1.3.0'));
    answerFetch(() => Response.json(CHANGELOG));
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'What’s new' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('What’s new in Shinsa')).toBeTruthy();
    expect(within(dialog).getByText('Everything that changed since Shinsa 1.2.0.')).toBeTruthy();
    expect(within(dialog).getByText('Shinsa 1.3.0')).toBeTruthy();
    expect(within(dialog).getByText('Mon, Nov 2, 2026')).toBeTruthy();
    expect(within(dialog).queryByText('Shinsa 1.2.0')).toBeNull();
    const headings = [...dialog.querySelectorAll('h4')].map((heading) => heading.textContent);
    expect(headings).toEqual(['New', 'Fixed']);
    expect(selectSeenVersion()).toBe('1.3.0');
    expect(screen.queryByRole('button', { name: 'What’s new' })).toBeNull();

    act(() => closeChangelog());
    await waitForGone(() => screen.queryByRole('dialog'));
  });

  it('shows no button on a fresh install', async () => {
    spyOnEngine(resolveEngineInfo('1.3.0'));
    const requests = answerFetch(() => Response.json(CHANGELOG));
    renderShell();
    await waitFor(() => expect(selectSeenVersion()).toBe('1.3.0'));
    expect(screen.queryByRole('button', { name: 'What’s new' })).toBeNull();
    expect(requests).toEqual([]);
  });

  it('lists every release, unreleased changes first, when opened from the menu', async () => {
    spyOnEngine(resolveEngineInfo('0.0.0'));
    answerFetch(() =>
      Response.json({
        releases: [
          { version: null, date: null, changes: [{ slug: 'next', kind: 'improved', text: 'Coming next.' }] },
          ...CHANGELOG.releases,
        ],
      })
    );
    renderShell();
    act(() => openChangelog());
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Not released yet');
    expect([...dialog.querySelectorAll('h3')].map((title) => title.textContent)).toEqual([
      'Not released yet',
      'Shinsa 1.3.0',
      'Shinsa 1.2.0',
    ]);
    expect(within(dialog).getByText('Every change to Shinsa, newest first.')).toBeTruthy();
  });

  it('says when there is nothing to list', async () => {
    answerFetch(() => Response.json({ releases: [] }));
    renderShell();
    act(() => openChangelog());
    expect(await screen.findByText('No changes are listed yet.')).toBeTruthy();
  });

  it('shows the engine’s refusal in place of the list', async () => {
    answerFetch(() => new Response('down', { status: 503 }));
    renderShell();
    act(() => openChangelog());
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.querySelector('p.text-red-text')).not.toBeNull());
  });
});
