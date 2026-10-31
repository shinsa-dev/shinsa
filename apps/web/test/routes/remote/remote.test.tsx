import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { PairView, RemoteInstance, RemoteSession, RemoteSnapshot, RemoteUser } from '@shinsa/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MachineAccessRequests, MachinesSettings } from '@/components/settings/machines.tsx';
import { Connection, connection } from '@/lib/connection/socket.ts';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import type { DeviceStore, EnrolledDevice } from '@/lib/remote/devices.ts';
import { Fleet } from '@/lib/remote/fleet.ts';
import { type RemoteServices, RemoteServicesContext } from '@/lib/remote/services.ts';
import { EnrollPage } from '@/routes/remote/enroll.tsx';
import { RemoteRoot } from '@/routes/remote/index.tsx';
import { PairPage } from '@/routes/remote/pair.tsx';

const USER: RemoteSession = { user: { id: '1', login: 'mona', name: null, avatarUrl: null } };

const STUDIO: RemoteInstance = {
  id: 'k3x9',
  name: 'Studio',
  fingerprint: 'abcd 1234',
  online: true,
  lastSeenAt: 1,
  createdAt: 0,
  owner: { id: '1', login: 'mona', name: null, avatarUrl: null },
  role: 'owner',
};

const PAIR: PairView = {
  claimCode: 'K7PQ',
  name: 'Studio',
  fingerprint: 'abcd 1234',
  expiresAt: 1,
  claimed: false,
};

const MACHINE_KEY = 'BOuB1lQ7xT4hH0uY1xKpE0dJ8wQ2r1n5o1yJ2v6H6Hc1Wl9xJ0sV2bq3cQ4uC5mE2c1Q4z8pR7tY0wX1aB2cD3';

function createDashboard(overrides: Partial<DashboardClient> = {}): DashboardClient {
  return {
    readSession: () => Promise.resolve(USER),
    listInstances: () => Promise.resolve([STUDIO]),
    requestConnect: () => Promise.resolve({ url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 }),
    removeInstance: () => Promise.resolve({ ok: true }),
    leaveInstance: () => Promise.resolve({ ok: true }),
    acceptInvite: () =>
      Promise.resolve({
        instanceId: 'k3x9',
        name: 'Studio',
        owner: USER.user as RemoteUser,
        user: USER.user as RemoteUser,
        connect: { url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 },
      }),
    readPair: () => Promise.resolve(PAIR),
    approvePair: () => Promise.resolve({ instanceId: 'k3x9', name: 'Studio' }),
    signOut: () => Promise.resolve({ ok: true }),
    ...overrides,
  };
}

function createDevices(device: EnrolledDevice | null = null): DeviceStore & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    selectDevice: () => Promise.resolve(device),
    writeDevice: () => Promise.resolve(),
    removeDevice: (instanceId) => {
      removed.push(instanceId);
      return Promise.resolve();
    },
  };
}

function createWorker(controlled = true) {
  const target = new EventTarget();
  return {
    register: () => Promise.resolve({} as ServiceWorkerRegistration),
    ready: Promise.resolve({} as ServiceWorkerRegistration),
    controller: controlled ? ({} as ServiceWorker) : null,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  } as unknown as ServiceWorkerContainer;
}

function renderRoot(path: string, services: Partial<RemoteServices> = {}) {
  history.replaceState(null, '', path);
  return render(
    <RemoteRoot
      services={{
        dashboard: createDashboard(),
        devices: createDevices(),
        worker: createWorker(),
        ...services,
      }}
      app={<p>The app</p>}
    />
  );
}

const assign = spyOn(location, 'assign').mockImplementation(() => undefined);

afterEach(() => {
  assign.mockClear();
  sessionStorage.clear();
});

const DEVICE: EnrolledDevice = {
  instanceId: 'k3x9',
  machineKey: 'mk',
  keys: {} as CryptoKeyPair,
  enrolledAt: 0,
};

describe('the remote dashboard', () => {
  it('asks you to sign in with GitHub and says why a sign-in failed', async () => {
    renderRoot('/?sign_in_error=sign_in_failed', {
      dashboard: createDashboard({ readSession: () => Promise.resolve({ user: null }) }),
    });
    const link = (await screen.findByText('Sign in with GitHub')).closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/__remote/sign-in?return=%2F');
    expect(screen.getByRole('alert').textContent).toContain('GitHub did not finish the sign-in');
  });

  it('says when app.shinsa.dev cannot be reached', async () => {
    renderRoot('/', {
      dashboard: createDashboard({
        readSession: () => Promise.reject(new Error('Couldn’t reach Shinsa Cloud.')),
      }),
    });
    expect((await screen.findByRole('alert')).textContent).toBe('Couldn’t reach Shinsa Cloud.');
  });

  it('asks to add this browser to the paired machines, or to pair one first', async () => {
    const { unmount } = renderRoot('/', { devices: createDevices() });
    expect(await screen.findByText('Add this device to your machine')).toBeTruthy();
    expect(screen.getByText(/Studio is paired/)).toBeTruthy();
    expect(screen.queryByText('mona')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    unmount();
    renderRoot('/', { dashboard: createDashboard({ listInstances: () => Promise.resolve([]) }) });
    expect(await screen.findByText('No machine yet')).toBeTruthy();
    expect(screen.getByText('Encrypted end to end')).toBeTruthy();
  });

  it('opens one dashboard over every machine this browser was added to, and gives the page back when it leaves', async () => {
    const local = connection;
    const view = renderRoot('/tasks', { devices: createDevices(DEVICE) });
    expect(await screen.findByText('The app')).toBeTruthy();
    expect(connection).toBeInstanceOf(Fleet);
    expect((connection as Fleet).members).toEqual([{ id: 'k3x9', name: 'Studio', current: false }]);
    view.unmount();
    expect(connection).toBe(local);
    expect(local).toBeInstanceOf(Connection);
  });

  it('says when this browser cannot reach your machines', async () => {
    const worker = createWorker();
    Object.assign(worker, { register: () => Promise.reject(new Error('Service workers are off.')) });
    const { unmount } = renderRoot('/', { devices: createDevices(DEVICE), worker });
    expect(await screen.findByText('This device cannot reach your machines')).toBeTruthy();
    unmount();
    renderRoot('/', {
      dashboard: createDashboard({ listInstances: () => Promise.reject(new Error('Signed out.')) }),
    });
    expect(await screen.findByText('This device cannot reach your machines')).toBeTruthy();
  });

  it('keeps the enrollment link out of the address bar and out of the sign-in redirect', async () => {
    renderRoot(`/enroll#k3x9.${MACHINE_KEY}.secret_1`, {
      dashboard: createDashboard({ readSession: () => Promise.resolve({ user: null }) }),
    });
    const link = (await screen.findByText('Sign in with GitHub')).closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/__remote/sign-in?return=%2Fenroll');
    expect(location.hash).toBe('');
    expect(location.pathname).toBe('/enroll');
  });

  it('routes to the pair page and the enroll page', async () => {
    const { unmount } = renderRoot('/pair?code=K7PQ');
    expect(await screen.findByText('Pair Studio with your account')).toBeTruthy();
    unmount();
    renderRoot(`/enroll#k3x9.${MACHINE_KEY}.secret_1`);
    expect(await screen.findByText('Add this device to your machine')).toBeTruthy();
  });
});

describe('access requests in Settings → Machines', () => {
  it('lists the requests waiting on each machine, and nothing when none wait', () => {
    const request = {
      id: 'r1',
      kind: 'invite' as const,
      publicKey: 'k',
      deviceName: 'Kai iPhone',
      user: { id: '7', login: 'kai', name: 'Kai Lane', avatarUrl: null },
      requestedAt: Date.now(),
    };
    const remote = { requests: [request], access: null } as unknown as RemoteSnapshot;
    const { unmount } = render(
      <MachineAccessRequests
        machines={[
          { id: 'k3x9', name: 'Studio', remote },
          { id: 'w4t8', name: 'Laptop', remote: null },
        ]}
      />
    );
    expect(screen.getByText('Access requests')).toBeTruthy();
    expect(screen.getByText('Waiting on Studio')).toBeTruthy();
    expect(screen.queryByText('Waiting on Laptop')).toBeNull();
    expect(screen.getByText('Kai Lane')).toBeTruthy();
    unmount();
    render(<MachineAccessRequests machines={[{ id: 'w4t8', name: 'Laptop', remote: null }]} />);
    expect(screen.queryByText('Access requests')).toBeNull();
  });
});

describe('the machines in Settings', () => {
  it('lists every machine with whether it is in this dashboard, and removes one', async () => {
    const devices = createDevices(DEVICE);
    render(
      <RemoteServicesContext.Provider
        value={{ dashboard: createDashboard(), devices, worker: createWorker() }}
      >
        <MachinesSettings />
      </RemoteServicesContext.Provider>
    );
    expect(await screen.findByText(/In this dashboard/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(devices.removed).toEqual(['k3x9']));
  });

  it('shows a shared machine with its owner, and leaves it instead of removing it', async () => {
    const devices = createDevices(DEVICE);
    const left: string[] = [];
    const removed: string[] = [];
    const shared: RemoteInstance = {
      ...STUDIO,
      owner: { id: '3', login: 'lee', name: 'Lee Park', avatarUrl: 'https://avatars.example/lee' },
      role: 'member',
    };
    const dashboard = createDashboard({
      listInstances: () => Promise.resolve([shared]),
      leaveInstance: (instanceId) => {
        left.push(instanceId);
        return Promise.resolve({ ok: true });
      },
      removeInstance: (instanceId) => {
        removed.push(instanceId);
        return Promise.resolve({ ok: true });
      },
    });
    render(
      <RemoteServicesContext.Provider value={{ dashboard, devices, worker: createWorker() }}>
        <MachinesSettings />
      </RemoteServicesContext.Provider>
    );
    expect(await screen.findByText('Shared by Lee Park · In this dashboard')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(devices.removed).toEqual(['k3x9']));
    expect(left).toEqual(['k3x9']);
    expect(removed).toEqual([]);
  });

  it('says when the machines cannot be read, and waits without the remote services', async () => {
    const { unmount } = render(
      <RemoteServicesContext.Provider
        value={{
          dashboard: createDashboard({ listInstances: () => Promise.reject(new Error('Signed out.')) }),
          devices: createDevices(),
          worker: createWorker(),
        }}
      >
        <MachinesSettings />
      </RemoteServicesContext.Provider>
    );
    expect((await screen.findByRole('alert')).textContent).toBe('Signed out.');
    unmount();
    render(
      <RemoteServicesContext.Provider
        value={{
          dashboard: createDashboard({ listInstances: () => Promise.resolve([]) }),
          devices: createDevices(),
          worker: createWorker(),
        }}
      >
        <MachinesSettings />
      </RemoteServicesContext.Provider>
    );
    expect(await screen.findByText(/No machine yet/)).toBeTruthy();
  });
});

describe('the pair page', () => {
  it('approves a machine after you check its fingerprint', async () => {
    render(<PairPage claimCode='K7PQ' dashboard={createDashboard()} />);
    expect(await screen.findByText('abcd 1234')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Studio is paired')).toBeTruthy();
  });

  it('says a code is missing, expired, already used, or that approving failed', async () => {
    const { unmount } = render(<PairPage claimCode={null} dashboard={createDashboard()} />);
    expect(screen.getByText('This link has no pairing code.')).toBeTruthy();
    unmount();
    const expired = render(
      <PairPage
        claimCode='K7PQ'
        dashboard={createDashboard({
          readPair: () => Promise.reject(new Error('This pairing code expired.')),
        })}
      />
    );
    expect(await screen.findByText('This pairing code expired.')).toBeTruthy();
    expired.unmount();
    const used = render(
      <PairPage
        claimCode='K7PQ'
        dashboard={createDashboard({ readPair: () => Promise.resolve({ ...PAIR, claimed: true }) })}
      />
    );
    expect(await screen.findByText('Studio is paired')).toBeTruthy();
    used.unmount();
    render(
      <PairPage
        claimCode='K7PQ'
        dashboard={createDashboard({ approvePair: () => Promise.reject(new Error('At most 5 machines.')) })}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('At most 5 machines.')).toBeTruthy();
  });
});

describe('the enroll page', () => {
  const link = {
    instanceId: 'k3x9',
    machineKey: MACHINE_KEY,
    secret: 'secret_1',
    invite: null,
    onMachine: false,
  };

  it('asks for access under the name it guessed, waits, then opens the machine', async () => {
    sessionStorage.setItem('shinsa.remote.enroll', 'x');
    let finish: () => void = () => undefined;
    const asked: string[] = [];
    render(
      <EnrollPage
        link={link}
        user={USER.user as RemoteUser}
        dashboard={createDashboard()}
        devices={createDevices()}
        resolveName={(invitee) => (invitee ? 'Never' : 'Chrome on Mac')}
        request={(_input, options) => {
          asked.push(options.name);
          options.onPending();
          return new Promise((resolve) => {
            finish = () => resolve({} as EnrolledDevice);
          });
        }}
      />
    );
    const field = screen.getByLabelText('Device name') as HTMLInputElement;
    expect(field.value).toBe('Chrome on Mac');
    fireEvent.change(field, { target: { value: ' Work Mac ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByText(/Accept it in Settings, Remote access/)).toBeTruthy();
    expect(asked).toEqual(['Work Mac']);
    finish();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(sessionStorage.getItem('shinsa.remote.enroll')).toBeNull();
  });

  it('asks to join someone else’s machine under a name with the GitHub name in front', async () => {
    const seen: (RemoteUser | null)[] = [];
    render(
      <EnrollPage
        link={{ ...link, invite: 'invite-token' }}
        user={USER.user as RemoteUser}
        dashboard={createDashboard()}
        devices={createDevices()}
        resolveName={(invitee) => {
          seen.push(invitee);
          return 'Mona iPhone';
        }}
        request={(_input, options) => {
          options.onPending();
          return new Promise(() => undefined);
        }}
      />
    );
    expect(screen.getByText('Join a shared machine')).toBeTruthy();
    expect(seen[0]).toEqual(USER.user);
    fireEvent.change(screen.getByLabelText('Device name'), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: 'Request access' }).hasAttribute('disabled')).toBe(true);
    fireEvent.submit(screen.getByLabelText('Device name'));
    expect(screen.queryByText(/Request sent/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Device name'), { target: { value: 'Mona iPhone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByText(/the machine’s owner accepts it/)).toBeTruthy();
  });

  it('says why the machine refused, and what to do with a link that cannot work', async () => {
    const { unmount } = render(
      <EnrollPage
        link={link}
        dashboard={createDashboard()}
        user={USER.user as RemoteUser}
        devices={createDevices()}
        resolveName={() => 'Chrome on Mac'}
        request={() => Promise.reject(new Error('Your request to reach this machine was declined.'))}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Your request to reach this machine was declined.'
    );
    unmount();
    render(
      <EnrollPage
        link={null}
        user={USER.user as RemoteUser}
        dashboard={createDashboard()}
        devices={createDevices()}
        resolveName={() => 'Chrome on Mac'}
      />
    );
    expect(screen.getByText('This link cannot add a device')).toBeTruthy();
  });
});
