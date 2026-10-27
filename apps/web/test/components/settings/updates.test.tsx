import { afterEach, describe, expect, it, mock } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { type UpdateActions, UpdateSettings, UpdatesGroup } from '@/components/settings/updates.tsx';
import type { DesktopUpdate } from '@/lib/desktop.ts';
import { installDesktop } from '../../support/desktop.ts';

let fake: ReturnType<typeof installDesktop> | null = null;

afterEach(() => {
  fake?.restore();
  fake = null;
});

function renderGroup(update: DesktopUpdate) {
  const actions: UpdateActions = {
    check: mock(() => undefined),
    install: mock(() => undefined),
    changeChannel: mock(),
    answerDowngrade: mock(),
  };
  render(
    <TooltipProvider>
      <UpdatesGroup app={{ version: '1.3.0-beta.2', channel: 'beta', update }} actions={actions} />
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
