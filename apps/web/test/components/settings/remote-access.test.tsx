import { describe, expect, it, mock } from 'bun:test';
import type { RemoteSnapshot } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteAccessGroup } from '@/components/settings/remote-access.tsx';
import type { RemoteAccessActions } from '@/lib/connection/remote-access.ts';
import { resolveOnMachineUrl } from '@/lib/remote/mode.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';

const ENROLL_URL = 'https://app.shinsa.dev/enroll#k3x9.machine-key.secret_1';

function createActions() {
  const snapshot = () => Promise.resolve(createRemoteSnapshot());
  return {
    pair: mock(snapshot),
    cancelPairing: mock(snapshot),
    resume: mock(snapshot),
    pause: mock(snapshot),
    remove: mock(snapshot),
    forgetDevice: mock((_publicKey: string) => snapshot()),
    createEnrollment: mock((name: string) =>
      Promise.resolve({ id: 'link-1', url: ENROLL_URL, name, expiresAt: Date.now() + 600_000 })
    ),
  } satisfies RemoteAccessActions;
}

function renderGroup(snapshot: RemoteSnapshot | null, failure: string | null = null) {
  const actions = createActions();
  render(
    <TooltipProvider>
      <RemoteAccessGroup snapshot={snapshot} failure={failure} actions={actions} />
    </TooltipProvider>
  );
  return actions;
}

describe('Settings → Remote access', () => {
  it('waits for the snapshot, or says why it could not read it', () => {
    renderGroup(null);
    expect(screen.getByText('Reading remote access…')).toBeTruthy();
  });

  it('shows the failure when it could not read the snapshot', () => {
    renderGroup(null, 'Shinsa answered with status 503.');
    expect(screen.getByText('Shinsa answered with status 503.')).toBeTruthy();
  });

  it('turns remote access on from the Off state', async () => {
    const actions = renderGroup(createRemoteSnapshot({ paired: false, status: 'off', owner: null }));
    expect(screen.queryByRole('button', { name: 'Add device' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(actions.pair).toHaveBeenCalled());
  });

  it('while pairing, links to the sign-in and can cancel it', async () => {
    const actions = renderGroup(
      createRemoteSnapshot({
        paired: false,
        pairing: {
          claimCode: 'K7PQ',
          url: 'https://app.shinsa.dev/pair?code=K7PQ',
          expiresAt: Date.now() + 1e5,
        },
      })
    );
    expect(screen.getByText('Waiting for sign-in')).toBeTruthy();
    expect(screen.getByText('Open sign-in').closest('a')?.getAttribute('href')).toBe(
      'https://app.shinsa.dev/pair?code=K7PQ'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(actions.cancelPairing).toHaveBeenCalled());
  });

  it('pauses, resumes and removes a paired machine, removal after a confirmation', async () => {
    const connected = renderGroup(createRemoteSnapshot());
    expect(screen.getByText('Connected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(connected.pause).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove remote access' }));
    await waitFor(() => expect(connected.remove).toHaveBeenCalled());
  });

  it('offers Resume when paused, and neither when app.shinsa.dev removed the machine', async () => {
    const paused = renderGroup(createRemoteSnapshot({ enabled: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(paused.resume).toHaveBeenCalled());
  });

  it('when removed at app.shinsa.dev, offers only Remove and no new devices', () => {
    renderGroup(createRemoteSnapshot({ status: 'revoked' }));
    expect(screen.getByText('Removed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add device' })).toBeNull();
  });

  it('lists the devices and forgets one after a confirmation', async () => {
    const actions = renderGroup(
      createRemoteSnapshot({
        devices: [
          {
            publicKey: 'dev-1',
            name: 'iPhone',
            enrolledAt: Date.now() - 1e6,
            lastSeenAt: null,
            enrollmentId: null,
          },
        ],
      })
    );
    expect(screen.getByText('iPhone')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Forget device' }));
    await waitFor(() => expect(actions.forgetDevice).toHaveBeenCalledWith('dev-1'));
  });

  it('adds a device: names it, then shows its one-time link as a QR code', async () => {
    const actions = renderGroup(createRemoteSnapshot());
    expect(screen.getByText('Devices that can reach this machine')).toBeTruthy();
    expect(screen.getByText(/None yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }));
    const make = await screen.findByRole('button', { name: 'Make link' });
    expect(make.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Device name'), { target: { value: ' iPhone ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make link' }));
    await screen.findByRole('img', { name: 'QR code for the link' });
    expect(actions.createEnrollment).toHaveBeenCalledWith('iPhone');
    expect(screen.getByText('Add iPhone')).toBeTruthy();
    expect(screen.getByText(ENROLL_URL)).toBeTruthy();
    expect(screen.getByText('Add this device').closest('a')?.getAttribute('href')).toBe(
      resolveOnMachineUrl(ENROLL_URL)
    );
  });
});
