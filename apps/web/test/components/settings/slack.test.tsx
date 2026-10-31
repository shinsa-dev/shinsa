import { afterEach, beforeEach, describe, expect, it, type Mock, mock, spyOn } from 'bun:test';
import type { SlackSnapshot } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SlackGroup, SlackSettings } from '@/components/settings/slack.tsx';
import type { SlackActions } from '@/lib/connection/slack.ts';
import { resetSlack } from '@/lib/connection/slack.ts';

const CONNECT_URL = 'https://app.shinsa.dev/slack/connect?instance=k3x9';

const LINK = { teamId: 'T1', teamName: 'Overclock', userId: 'U1', userName: 'Christo', linkedAt: Date.now() };

function snapshot(overrides: Partial<SlackSnapshot> = {}): SlackSnapshot {
  return { remote: true, connectUrl: CONNECT_URL, links: [], problem: null, ...overrides };
}

function renderGroup(current: SlackSnapshot | null, failure: string | null = null, onMachine = true) {
  const actions = { disconnect: mock(() => Promise.resolve(snapshot())) } satisfies SlackActions;
  render(
    <TooltipProvider>
      <SlackGroup snapshot={current} failure={failure} onMachine={onMachine} actions={actions} />
    </TooltipProvider>
  );
  return actions;
}

describe('Settings → General → Slack', () => {
  it('waits for the snapshot, or says why it could not read it', () => {
    renderGroup(null);
    expect(screen.getByText('Reading Slack…')).toBeTruthy();
  });

  it('shows the failure when it could not read the snapshot', () => {
    renderGroup(null, 'Shinsa answered with status 503.');
    expect(screen.getByText('Shinsa answered with status 503.')).toBeTruthy();
  });

  it('asks for remote access above it first, with nothing to connect yet', () => {
    renderGroup(snapshot({ remote: false, connectUrl: null }));
    expect(screen.getByText('Needs remote access')).toBeTruthy();
    expect(screen.getByText(/Turn it on above first/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('connects through app.shinsa.dev in a new tab', () => {
    renderGroup(snapshot());
    const connect = screen.getByText('Connect Slack').closest('a') as HTMLAnchorElement;
    expect(connect.getAttribute('href')).toBe(CONNECT_URL);
    expect(connect.getAttribute('target')).toBe('_blank');
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });

  it('lists each connected workspace, offers another, and disconnects after asking', async () => {
    const actions = renderGroup(snapshot({ links: [LINK] }));
    expect(screen.getByText('Overclock')).toBeTruthy();
    expect(screen.getByText(/as Christo$/)).toBeTruthy();
    expect(screen.getByText('Connect another workspace').closest('a')?.getAttribute('href')).toBe(
      CONNECT_URL
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Slack' }));
    await waitFor(() => expect(actions.disconnect).toHaveBeenCalled());
  });

  it('on app.shinsa.dev connects and lists workspaces, and sends Disconnect to the machine', () => {
    renderGroup(snapshot({ links: [LINK] }), null, false);
    expect(screen.getByText('Overclock')).toBeTruthy();
    expect(screen.getByText('Connect another workspace').closest('a')?.getAttribute('href')).toBe(
      CONNECT_URL
    );
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(screen.getByText('Disconnect is in Settings on the machine itself.')).toBeTruthy();
  });

  it('shows nothing to connect when the engine has no link to give', () => {
    renderGroup(snapshot({ connectUrl: null }));
    expect(screen.queryByText('Connect Slack')).toBeNull();
  });
});

describe('SlackSettings', () => {
  let fetchSpy: Mock<typeof fetch>;

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (_input: RequestInfo | URL) =>
      Response.json(snapshot({ links: [LINK] }))) as typeof fetch);
  });

  afterEach(() => {
    act(() => resetSlack());
    fetchSpy.mockRestore();
  });

  it('reads Slack from the engine', async () => {
    render(
      <TooltipProvider>
        <SlackSettings />
      </TooltipProvider>
    );
    expect(await screen.findByText('Overclock')).toBeTruthy();
  });
});
