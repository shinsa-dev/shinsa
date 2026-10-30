import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { PairView, RemoteInstance, RemoteSession } from '@shinsa/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MachinesSettings } from '@/components/settings/machines.tsx';
import { Connection, connection } from '@/lib/connection/socket.ts';
import type { DashboardClient } from '@/lib/remote/dashboard.ts';
import type { DeviceStore, EnrolledDevice } from '@/lib/remote/devices.ts';
import { Fleet } from '@/lib/remote/fleet.ts';
import { type RemoteServices, RemoteServicesContext } from '@/lib/remote/services.ts';
import { EnrollPage } from '@/routes/remote/enroll.tsx';
import { RemoteRoot } from '@/routes/remote/index.tsx';
import { PairPage } from '@/routes/remote/pair.tsx';

const USER: RemoteSession = { user: { id: '1', login: 'mona', avatarUrl: null } };

const STUDIO: RemoteInstance = {
  id: 'k3x9',
  name: 'Studio',
  fingerprint: 'abcd 1234',
  online: true,
  lastSeenAt: 1,
  createdAt: 0,
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
    renderRoot('/?sign_in_error=sign_in_refused', {
      dashboard: createDashboard({ readSession: () => Promise.resolve({ user: null }) }),
    });
    const link = (await screen.findByText('Sign in with GitHub')).closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/__remote/sign-in?return=%2F');
    expect(screen.getByRole('alert').textContent).toContain('cannot use this Shinsa');
  });

  it('says when app.shinsa.dev cannot be reached', async () => {
    renderRoot('/', {
      dashboard: createDashboard({
        readSession: () => Promise.reject(new Error('Couldn’t reach app.shinsa.dev.')),
      }),
    });
    expect((await screen.findByRole('alert')).textContent).toBe('Couldn’t reach app.shinsa.dev.');
  });

  it('asks to add this browser to the paired Macs, or to pair one first', async () => {
    const { unmount } = renderRoot('/', { devices: createDevices() });
    expect(await screen.findByText('Add this browser to your Mac')).toBeTruthy();
    expect(screen.getByText(/Studio is paired/)).toBeTruthy();
    expect(screen.queryByText('mona')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    unmount();
    renderRoot('/', { dashboard: createDashboard({ listInstances: () => Promise.resolve([]) }) });
    expect(await screen.findByText('No Mac yet')).toBeTruthy();
  });

  it('opens one dashboard over every Mac this browser was added to, and gives the page back when it leaves', async () => {
    const local = connection;
    const view = renderRoot('/tasks', { devices: createDevices(DEVICE) });
    expect(await screen.findByText('The app')).toBeTruthy();
    expect(connection).toBeInstanceOf(Fleet);
    expect((connection as Fleet).members).toEqual([{ id: 'k3x9', name: 'Studio' }]);
    view.unmount();
    expect(connection).toBe(local);
    expect(local).toBeInstanceOf(Connection);
  });

  it('says when this browser cannot reach your Macs', async () => {
    const worker = createWorker();
    Object.assign(worker, { register: () => Promise.reject(new Error('Service workers are off.')) });
    const { unmount } = renderRoot('/', { devices: createDevices(DEVICE), worker });
    expect(await screen.findByText('This browser cannot reach your Macs')).toBeTruthy();
    unmount();
    renderRoot('/', {
      dashboard: createDashboard({ listInstances: () => Promise.reject(new Error('Signed out.')) }),
    });
    expect(await screen.findByText('This browser cannot reach your Macs')).toBeTruthy();
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
    expect(await screen.findByText('Add this browser to your Mac')).toBeTruthy();
  });
});

describe('the Macs in Settings', () => {
  it('lists every Mac with whether it is in this dashboard, and removes one', async () => {
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

  it('says when the Macs cannot be read, and waits without the remote services', async () => {
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
    expect(await screen.findByText(/No Mac yet/)).toBeTruthy();
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
  const link = { instanceId: 'k3x9', machineKey: MACHINE_KEY, secret: 'secret_1' };

  it('adds this browser and opens the machine', async () => {
    sessionStorage.setItem('shinsa.remote.enroll', 'x');
    render(
      <EnrollPage
        link={link}
        dashboard={createDashboard()}
        devices={createDevices()}
        enroll={() => Promise.resolve({} as EnrolledDevice)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add this browser' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(sessionStorage.getItem('shinsa.remote.enroll')).toBeNull();
  });

  it('says why the Mac refused, and what to do with a link that cannot work', async () => {
    const { unmount } = render(
      <EnrollPage
        link={link}
        dashboard={createDashboard()}
        devices={createDevices()}
        enroll={() => Promise.reject(new Error('This browser is not enrolled on this Mac.'))}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add this browser' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This browser is not enrolled on this Mac.');
    unmount();
    render(<EnrollPage link={null} dashboard={createDashboard()} devices={createDevices()} />);
    expect(screen.getByText('This link cannot add a browser')).toBeTruthy();
  });
});
