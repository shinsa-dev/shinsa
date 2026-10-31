import { describe, expect, it, mock } from 'bun:test';
import type { RemoteSnapshot } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteAccessGroup } from '@/components/settings/remote-access.tsx';
import type { RemoteAccessActions } from '@/lib/connection/remote-access.ts';
import { resolveOnMachineUrl } from '@/lib/remote/mode.ts';
import { spyOnToasts } from '../../support/commands.ts';
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
    removeMember: mock((_userId: string) => snapshot()),
    createLink: mock((_kind: 'device' | 'invite') => snapshot()),
    removeLink: mock((_kind: 'device' | 'invite') => snapshot()),
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
  kind: 'invite' as const,
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
    expect(screen.queryByRole('button', { name: 'Add device' })).toBeNull();
    expect(screen.getByText('Devices that can reach this machine')).toBeTruthy();
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
            userId: null,
          },
        ],
      })
    );
    expect(screen.getByText('iPhone')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Forget device' }));
    await waitFor(() => expect(actions.forgetDevice).toHaveBeenCalledWith('dev-1'));
  });

  it('makes the Add device link without asking for a name, then shows it as a QR code', async () => {
    const actions = renderGroup(createRemoteSnapshot());
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }));
    expect(await screen.findByText(/Make a link for your own devices/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make link' }));
    await waitFor(() => expect(actions.createLink).toHaveBeenCalledWith('device'));
    actions.push(
      createRemoteSnapshot({ links: [{ kind: 'device', url: ENROLL_URL, createdAt: Date.now() }] })
    );
    expect(await screen.findByRole('img', { name: 'QR code for the link' })).toBeTruthy();
    expect(screen.getByText(ENROLL_URL)).toBeTruthy();
    expect(screen.getByText(/It works until you turn it off/)).toBeTruthy();
    const here = screen.getByText('Add this device').closest('a');
    expect(here?.getAttribute('href')).toBe(resolveOnMachineUrl(ENROLL_URL));
  });

  it('makes a new link or turns the link off', async () => {
    const toasts = spyOnToasts();
    const actions = renderGroup(
      createRemoteSnapshot({
        links: [{ kind: 'invite', url: `${ENROLL_URL}.invite`, createdAt: Date.now() }],
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Invite someone' }));
    expect(await screen.findByText(/Share this link with the people you want/)).toBeTruthy();
    expect(screen.queryByText('Add this device')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Make new link' }));
    await waitFor(() => expect(actions.createLink).toHaveBeenCalledWith('invite'));
    fireEvent.click(screen.getByRole('button', { name: 'Turn off link' }));
    await waitFor(() => expect(actions.removeLink).toHaveBeenCalledWith('invite'));
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith(expect.stringContaining('The link is turned off.'))
    );
    toasts.restore();
  });

  it('shows who asks for access and accepts or declines each request', async () => {
    const toasts = spyOnToasts();
    const actions = renderGroup(
      createRemoteSnapshot({
        requests: [REQUEST, { ...REQUEST, id: 'r2', kind: 'device' }],
        access: { owner: { id: '1', login: 'mona', name: null, avatarUrl: null }, members: [] },
      })
    );
    expect(screen.getByText('Waiting for your answer')).toBeTruthy();
    expect(screen.getByText(/^Kai iPhone · Invite · Asked/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0] as HTMLElement);
    await waitFor(() => expect(actions.acceptRequest).toHaveBeenCalledWith('r1'));
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith(
        '@kai joins this machine with full control, and Kai iPhone is added.'
      )
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Decline' })[1] as HTMLElement);
    await waitFor(() => expect(actions.declineRequest).toHaveBeenCalledWith('r2'));
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
    expect(screen.getByText('@mona')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByText('Kai Lane')).toBeTruthy();
    expect(screen.getByText('@kai')).toBeTruthy();
    expect(screen.getByText(/Added by @kai/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1) as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove member' }));
    await waitFor(() => expect(actions.removeMember).toHaveBeenCalledWith('7'));
  });

  it('says only you can reach it before anyone is invited', () => {
    renderGroup(createRemoteSnapshot());
    expect(screen.getByText(/Only you\. Invite someone/)).toBeTruthy();
  });
});
