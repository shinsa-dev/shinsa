import { afterEach, describe, expect, it, mock } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { type UpdateActions, UpdateSettings, UpdatesGroup } from '@/components/settings/updates.tsx';
import { refreshHealth } from '@/lib/connection/health.ts';
import type { DesktopUpdate, UpdateChannel } from '@/lib/desktop.ts';
import { installDesktop } from '../../support/desktop.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';

let fake: ReturnType<typeof installDesktop> | null = null;

let server: ReturnType<typeof startFakeOnboarding> | null = null;

afterEach(async () => {
  fake?.restore();
  fake = null;
  server?.stop();
  server = startFakeOnboarding({ 'GET /api/health': { answer: { ok: true, seq: 1, problems: [] } } });
  await act(() => refreshHealth());
  server.stop();
  server = null;
});

function renderGroup(update: DesktopUpdate, version = '1.3.0-beta.2', channel: UpdateChannel = 'beta') {
  const actions: UpdateActions = {
    check: mock(() => undefined),
    install: mock(() => undefined),
    changeChannel: mock(),
    answerDowngrade: mock(),
  };
  render(
    <TooltipProvider>
      <UpdatesGroup app={{ version, channel, update }} actions={actions} />
    </TooltipProvider>
  );
  return actions;
}

describe('the Updates settings', () => {
  it('shows the app’s version and channel, checks on request and restarts into a ready update', () => {
    const actions = renderGroup({ status: 'ready', version: '1.3.0-beta.3' });
    expect(screen.getByText('1.3.0-beta.2')).toBeTruthy();
    expect(screen.getByText('1.3.0-beta.3 is ready')).toBeTruthy();
    expect(screen.getByText('Beta channel · Updates install when you quit Shinsa')).toBeTruthy();
    const note = screen.getByText(
      'Updating or quitting the app never stops your agents. After an update the engine restarts into the new version on its own, and agents pick up where they were.'
    );
    expect(note.previousElementSibling?.textContent).toContain('Update channel');
    expect(note.parentElement?.tagName).toBe('SECTION');
    expect(screen.queryByText('Engine')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(actions.check).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    expect(actions.install).toHaveBeenCalled();
  });

  it('offers a beta on Stable to go back to the latest stable release, or to stay', () => {
    const actions = renderGroup({ status: 'downgrade', version: '1.2.0' });
    expect(screen.getByText('Go back to 1.2.0 (stable)?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download and install' }));
    expect(actions.answerDowngrade).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Stay on this beta' }));
    expect(actions.answerDowngrade).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('button', { name: 'Restart to update' })).toBeNull();
  });

  it('offers Stable, Beta and Canary in one picker, with no separate app to download', () => {
    renderGroup({ status: 'current' });
    fireEvent.click(screen.getByRole('combobox', { name: 'Update channel' }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['Stable', 'Beta', 'Canary']);
    expect(screen.queryByText('Shinsa Canary')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download Shinsa Canary' })).toBeNull();
  });

  it('on Canary shows Shinsa with the picker, so you can leave the channel', () => {
    renderGroup(
      { status: 'downloading', version: '1.3.1-canary.5', percent: 42 },
      '1.3.1-canary.4',
      'canary'
    );
    expect(screen.getByText('Shinsa')).toBeTruthy();
    expect(screen.getByText('Downloading 1.3.1-canary.5… 42%')).toBeTruthy();
    expect(screen.getByText('Canary channel · Updates install when you quit Shinsa')).toBeTruthy();
    expect(
      screen.getByText('Every merge into main once its tests pass. Less tested than Beta.')
    ).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Update channel' })).toBeTruthy();
  });

  it('offers the restart only once the update is prepared, and not again while it restarts', () => {
    renderGroup({ status: 'preparing', version: '1.3.0-beta.3' });
    expect(screen.getByText('Preparing 1.3.0-beta.3…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restart to update' })).toBeNull();
  });

  it('shows the restart under way without a button to click again', () => {
    renderGroup({ status: 'installing', version: '1.3.0-beta.3' });
    expect(screen.getByText('Restarting to install 1.3.0-beta.3…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restart to update' })).toBeNull();
  });

  it('has no restart button and no status before the first check', () => {
    renderGroup({ status: 'none' });
    expect(screen.queryByRole('button', { name: 'Restart to update' })).toBeNull();
    expect(screen.getByText('Update channel')).toBeTruthy();
  });

  it('shows the engine moving to the new version in one line', () => {
    render(
      <UpdatesGroup
        app={{ version: '1.3.0-beta.3', channel: 'beta', update: { status: 'current' } }}
        engine={{ version: '1.3.0-beta.2', label: 'Moving to 1.3.0-beta.3…', tone: 'neutral' }}
        actions={{ check: mock(), install: mock(), changeChannel: mock(), answerDowngrade: mock() }}
      />
    );
    expect(screen.getByText('Engine')).toBeTruthy();
    expect(screen.getByText('1.3.0-beta.2')).toBeTruthy();
    expect(screen.getByText('Moving to 1.3.0-beta.3…')).toBeTruthy();
  });

  it('in the app reads the engine’s version from its health', async () => {
    fake = installDesktop();
    fake.bridge.version = '1.2.0';
    fake.bridge.protocol = 2;
    fake.bridge.update = { status: 'current' };
    server = startFakeOnboarding({
      'GET /api/health': { answer: { ok: true, seq: 1, problems: [], version: '1.1.0', protocol: 2 } },
    });
    await act(() => refreshHealth());
    render(
      <TooltipProvider>
        <UpdateSettings />
      </TooltipProvider>
    );
    expect(screen.getByText('Moving to 1.2.0…')).toBeTruthy();
    expect(screen.getByText('1.1.0')).toBeTruthy();
  });

  it('in a browser points to the app', () => {
    render(
      <TooltipProvider>
        <UpdateSettings />
      </TooltipProvider>
    );
    expect(
      screen.getByText(
        'Shinsa for Mac updates itself. Its version and update channel are in its own Settings.'
      )
    ).toBeTruthy();
  });

  it('in the app reads the bridge', () => {
    fake = installDesktop();
    fake.bridge.version = '1.2.0';
    fake.bridge.update = { status: 'current' };
    render(
      <TooltipProvider>
        <UpdateSettings />
      </TooltipProvider>
    );
    expect(screen.getByText('1.2.0')).toBeTruthy();
    expect(screen.getByText('Up to date')).toBeTruthy();
    expect(screen.getByText('Stable channel · Updates install when you quit Shinsa')).toBeTruthy();
  });
});
