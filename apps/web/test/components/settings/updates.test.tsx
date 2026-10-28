import { afterEach, describe, expect, it, mock } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { type UpdateActions, UpdateSettings, UpdatesGroup } from '@/components/settings/updates.tsx';
import type { DesktopUpdate, UpdateChannel } from '@/lib/desktop.ts';
import { installDesktop } from '../../support/desktop.ts';

let fake: ReturnType<typeof installDesktop> | null = null;

afterEach(() => {
  fake?.restore();
  fake = null;
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
