import { describe, expect, it, mock } from 'bun:test';
import type { RemoteSnapshot } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteAccessGroup } from '@/components/settings/remote-access.tsx';
import type { RemoteAccessActions } from '@/lib/connection/remote-access.ts';
import { resolveOnMachineUrl } from '@/lib/remote/mode.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';

const ENROLL_URL = 'https://app.shinsa.dev/enroll#k3x9.machine-key.secret_1.tok';

function createActions() {
  const snapshot = () => Promise.resolve(createRemoteSnapshot());
  return {
    pair: mock(snapshot),
    cancelPairing: mock(snapshot),
    resume: mock(snapshot),
    pause: mock(snapshot),
    remove: mock(snapshot),
    revokeDevice: mock((_publicKey: string) => snapshot()),
    removeMember: mock((_userId: string) => snapshot()),
    createLink: mock(snapshot),
    removeLink: mock(snapshot),
    acceptRequest: mock((_requestId: string) => snapshot()),
    declineRequest: mock((_requestId: string) => snapshot()),
  } satisfies RemoteAccessActions;
}

function renderGroup(snapshot: RemoteSnapshot | null, failure: string | null = null) {
  const actions = createActions();
  const view = (next: RemoteSnapshot | null) => (
    <TooltipProvider>
      <RemoteAccessGroup snapshot={next} failure={failure} actions={actions} />
    </TooltipProvider>
  );
  const { rerender } = render(view(snapshot));
  return Object.assign(actions, { push: (next: RemoteSnapshot) => rerender(view(next)) });
}

function createDevice(publicKey: string) {
  return { publicKey, name: 'iPhone', enrolledAt: Date.now(), lastSeenAt: null, userId: null };
}

const KAI = { id: '7', login: 'kai', name: 'Kai Lane', avatarUrl: null };

const REQUEST = {
  id: 'r1',
  publicKey: 'kai-phone',
  deviceName: 'Kai iPhone',
  user: KAI,
  requestedAt: Date.now() - 60_000,
};

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
    expect(screen.queryByRole('button', { name: 'Invite link' })).toBeNull();
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
    expect(screen.queryByRole('button', { name: 'Invite link' })).toBeNull();
    expect(screen.getByText('Devices that can reach this machine')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(paused.resume).toHaveBeenCalled());
  });

  it('when removed at app.shinsa.dev, offers only Remove and no new devices', () => {
    renderGroup(createRemoteSnapshot({ status: 'revoked' }));
    expect(screen.getByText('Removed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite link' })).toBeNull();
  });

  it('lists the devices and revokes one after a confirmation', async () => {
    const actions = renderGroup(
      createRemoteSnapshot({
        devices: [
          {
            publicKey: 'dev-1',
            name: 'iPhone',
            enrolledAt: Date.now() - 1e6,
            lastSeenAt: null,
            userId: null,
          },
        ],
      })
    );
    expect(screen.getByText('iPhone')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke device' }));
    await waitFor(() => expect(actions.revokeDevice).toHaveBeenCalledWith('dev-1'));
  });

  it('makes the one invite link without asking for a name, then shows it as a QR code', async () => {
    const actions = renderGroup(createRemoteSnapshot());
    fireEvent.click(screen.getByRole('button', { name: 'Invite link' }));
    expect(await screen.findByText(/Make one link for your own devices and for other people/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make link' }));
    await waitFor(() => expect(actions.createLink).toHaveBeenCalled());
    actions.push(createRemoteSnapshot({ link: { url: ENROLL_URL, createdAt: Date.now() } }));
    expect(await screen.findByRole('img', { name: 'QR code for the link' })).toBeTruthy();
    expect(screen.getByText(ENROLL_URL)).toBeTruthy();
    expect(screen.queryByText(/^Made /)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make new link' })).toBeNull();
    const here = screen.getByText('Add this device').closest('a');
    expect(here?.getAttribute('href')).toBe(resolveOnMachineUrl(ENROLL_URL));
  });

  it('offers no Add this device through remote access, where the device has its key already', async () => {
    import.meta.env.VITE_SHINSA_REMOTE = '1';
    try {
      renderGroup(createRemoteSnapshot({ link: { url: ENROLL_URL, createdAt: Date.now() } }));
      fireEvent.click(screen.getByRole('button', { name: 'Invite link' }));
      expect(await screen.findByText(ENROLL_URL)).toBeTruthy();
      expect(screen.queryByText('Add this device')).toBeNull();
    } finally {
      import.meta.env.VITE_SHINSA_REMOTE = undefined;
    }
  });

  it('turns the link off with a short toast', async () => {
    const toasts = spyOnToasts();
    const actions = renderGroup(createRemoteSnapshot({ link: { url: ENROLL_URL, createdAt: Date.now() } }));
    fireEvent.click(screen.getByRole('button', { name: 'Invite link' }));
    expect(await screen.findByText(/Open it on your own device, or share it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off link' }));
    await waitFor(() => expect(actions.removeLink).toHaveBeenCalled());
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('The link is off.'));
    toasts.restore();
  });

  it('shows who asks for access and accepts or declines each request', async () => {
    const toasts = spyOnToasts();
    const mona = { id: '1', login: 'mona', name: null, avatarUrl: null };
    const actions = renderGroup(
      createRemoteSnapshot({
        requests: [REQUEST, { ...REQUEST, id: 'r2', deviceName: 'Chrome on Mac', user: mona }],
        access: { owner: mona, members: [] },
      })
    );
    expect(screen.getByText('Waiting for your answer')).toBeTruthy();
    expect(screen.getByText('Kai Lane')).toBeTruthy();
    expect(screen.getByText(/^Kai iPhone · Asked/)).toBeTruthy();
    expect(screen.getByText('Chrome on Mac')).toBeTruthy();
    expect(screen.getAllByText('mona').map((name) => name.closest('a')?.getAttribute('href'))).toEqual([
      'https://github.com/mona',
    ]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0] as HTMLElement);
    await waitFor(() => expect(actions.acceptRequest).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Kai joined.'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Decline' })[1] as HTMLElement);
    await waitFor(() => expect(actions.declineRequest).toHaveBeenCalledWith('r2'));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Request declined.'));
    toasts.restore();
  });

  it('lists who can reach the machine, marks the devices a member added, and removes a member', async () => {
    const kai = { id: '7', login: 'kai', name: 'Kai Lane', avatarUrl: 'https://avatars.example/kai' };
    const owner = { id: '1', login: 'mona', name: null, avatarUrl: null };
    const actions = renderGroup(
      createRemoteSnapshot({
        devices: [{ ...createDevice('kai-phone'), userId: '7' }],
        access: { owner, members: [{ user: kai, addedAt: Date.now() - 3_600_000 }] },
      })
    );
    expect(screen.getByText('People who can reach this machine')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(
      screen
        .getByText(/^Signed in as/)
        .querySelector('a')
        ?.getAttribute('href')
    ).toBe('https://github.com/mona');
    expect(screen.getAllByText('mona')).toHaveLength(1);
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByText('Kai Lane')).toBeTruthy();
    expect(screen.getByText('kai')).toBeTruthy();
    const added = screen.getByText(/· Added by$/).parentElement;
    expect(added?.textContent).toEndWith('Added by Kai');
    expect(added?.querySelector('a')?.getAttribute('href')).toBe('https://github.com/kai');
    expect(added?.querySelector('img')?.getAttribute('src')).toBe('https://avatars.example/kai');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1) as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove member' }));
    await waitFor(() => expect(actions.removeMember).toHaveBeenCalledWith('7'));
  });

  it('says only you can reach it before anyone is invited', () => {
    renderGroup(createRemoteSnapshot());
    expect(screen.getByText(/Only you\. Share the invite link/)).toBeTruthy();
  });
});
