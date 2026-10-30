import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { refreshHealth, type ServerHealth } from '@/lib/connection/health.ts';
import { writeLayoutPreference } from '@/lib/preferences/layout.ts';
import { Root } from '@/root.tsx';
import { createOnboardingStatus, startFakeOnboarding } from '../../support/onboarding.ts';
import { pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState } from '../../support/state.ts';

const DAMAGED: ServerHealth = {
  ok: false,
  seq: 120,
  problems: [
    { seq: 41, type: 'task.staged', kind: 'unreadable', error: 'Not JSON' },
    { seq: 57, type: 'run.ended', kind: 'unappliable', error: 'No such run' },
  ],
};

let health: ServerHealth = DAMAGED;

let fake: ReturnType<typeof startFakeOnboarding> | null = null;

beforeEach(() => {
  health = DAMAGED;
  fake = startFakeOnboarding({
    'GET /api/health': { answer: () => health },
    'GET /api/onboarding': { answer: createOnboardingStatus() },
  });
  startFakeServer();
});

afterEach(async () => {
  health = { ok: true, seq: 120, problems: [] };
  await act(() => refreshHealth());
  stopFakeServer();
  fake?.stop();
  fake = null;
});

function renderRoot() {
  render(<Root />);
  pushState(createShinsaState({}));
}

async function findBanner(count: number) {
  return screen.findByText(
    `Shinsa skipped ${count} damaged entries in its log at start. Everything else loaded.`
  );
}

describe('the health banner', () => {
  it('appears in the Cards layout while the log has problems, lists them, and goes away when dismissed', async () => {
    renderRoot();
    const banner = (await findBanner(2)).closest('[role="status"]') as HTMLElement;
    const details = within(banner).getByText('Details');
    await act(async () => {
      fireEvent.pointerEnter(details);
      fireEvent.mouseEnter(details);
      fireEvent.pointerMove(details);
    });
    expect(await screen.findByText('Entry 41 · task.staged')).toBeTruthy();
    expect(screen.getByText('Entry 57 · run.ended')).toBeTruthy();
    expect(screen.getByText('Unreadable')).toBeTruthy();
    expect(screen.getByText('Not applied')).toBeTruthy();
    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/damaged entries/)).toBeNull();
  });

  it('stays away after a reload once dismissed', async () => {
    renderRoot();
    const banner = (await findBanner(2)).closest('[role="status"]') as HTMLElement;
    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }));
    cleanup();
    const reads = fake?.requests.length ?? 0;
    renderRoot();
    await waitFor(() => expect(fake?.requests.length ?? 0).toBeGreaterThan(reads));
    await act(() => refreshHealth());
    expect(screen.queryByText(/damaged entr/)).toBeNull();
  });

  it('appears in the Sidebar layout too, and only once', async () => {
    writeLayoutPreference('sidebar');
    health = {
      ...DAMAGED,
      problems: [...DAMAGED.problems, { seq: 60, type: 'gate.opened', kind: 'unreadable', error: 'Torn' }],
    };
    renderRoot();
    await findBanner(3);
    expect(screen.getAllByText(/damaged entries/)).toHaveLength(1);
  });

  it('stays away while the log loaded cleanly', async () => {
    health = { ok: true, seq: 120, problems: [] };
    renderRoot();
    await waitFor(() => expect(fake?.requests.some((request) => request.path === '/api/health')).toBe(true));
    expect(screen.queryByRole('status', { name: /damaged/ })).toBeNull();
    expect(screen.queryByText(/damaged entr/)).toBeNull();
  });
});
