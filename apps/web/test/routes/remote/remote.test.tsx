import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
  createState,
  type PairView,
  type RemoteInstance,
  type RemoteSession,
  type RemoteSnapshot,
  type RemoteUser,
} from '@shinsa/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MachineAccessRequests, MachinesSettings } from '@/components/settings/machines.tsx';
import {
  Connection,
  connection,
  type MachineChoice,
  replaceConnection,
  type Snapshot,
} from '@/lib/connection/socket.ts';
import { type DashboardClient, DashboardError } from '@/lib/remote/dashboard.ts';
import type { DeviceStore, EnrolledDevice } from '@/lib/remote/devices.ts';
import { Fleet } from '@/lib/remote/fleet.ts';
import { type RemoteServices, RemoteServicesContext } from '@/lib/remote/services.ts';
import type { TeamKeyStore } from '@/lib/teams/join.ts';
import { ClaimPage } from '@/routes/remote/claim.tsx';
import { EnrollPage } from '@/routes/remote/enroll.tsx';
import { RemoteRoot } from '@/routes/remote/index.tsx';
import { PairPage } from '@/routes/remote/pair.tsx';
import { createMachineResources, createTaskResources } from '../../support/resources.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

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
    listTeams: () => Promise.resolve([]),
    acceptInvite: () =>
      Promise.resolve({
        instanceId: 'k3x9',
        name: 'Studio',
        owner: USER.user as RemoteUser,
        user: USER.user as RemoteUser,
        connect: { url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 },
      }),
    acceptHandoff: () =>
      Promise.resolve({
        instanceId: 'k3x9',
        name: 'Studio',
        owner: USER.user as RemoteUser,
        user: USER.user as RemoteUser,
        connect: { url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 },
      }),
    previewTeam: () => Promise.resolve({ name: 'Platform', owner: USER.user as RemoteUser }),
    joinTeam: () =>
      Promise.resolve({
        teamId: 'team1',
        name: 'Platform',
        owner: USER.user as RemoteUser,
        status: 'requested',
      }),
    readPair: () => Promise.resolve(PAIR),
    approvePair: () => Promise.resolve({ instanceId: 'k3x9', name: 'Studio' }),
    signOut: () => Promise.resolve({ ok: true }),
    ...overrides,
  };
}

function createDevices(
  device: EnrolledDevice | null = null,
  waiting: EnrolledDevice[] = []
): DeviceStore & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    selectDevice: () => Promise.resolve(device),
    listWaitingDevices: () => Promise.resolve(waiting),
    writeDevice: () => Promise.resolve(),
    removeDevice: (instanceId) => {
      removed.push(instanceId);
      return Promise.resolve();
    },
  };
}

function createTeamKeys(): TeamKeyStore {
  return { selectTeamKey: () => Promise.resolve(null), writeTeamKey: () => Promise.resolve() };
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
        teamKeys: createTeamKeys(),
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

  it('says a device that asked and left is still waiting for an answer, on a machine listed or not yet', async () => {
    const waiting = { ...DEVICE, waiting: { machineName: 'Studio' } };
    const { unmount } = renderRoot('/', {
      dashboard: createDashboard({ requestConnect: () => Promise.reject(new Error('Offline.')) }),
      devices: createDevices(waiting),
    });
    expect(await screen.findByText('Waiting for an answer')).toBeTruthy();
    expect(screen.getByText(/This device asked to reach Studio\./)).toBeTruthy();
    unmount();
    renderRoot('/', {
      dashboard: createDashboard({ listInstances: () => Promise.resolve([]) }),
      devices: createDevices(null, [
        { ...waiting, instanceId: 'v9q1', waiting: { machineName: 'Team server' } },
      ]),
    });
    expect(await screen.findByText(/This device asked to reach Team server\./)).toBeTruthy();
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

  it('drops a machine from the dashboard and forgets its key once Shinsa Cloud no longer knows it', async () => {
    const devices = createDevices(DEVICE);
    const view = renderRoot('/tasks', {
      devices,
      dashboard: createDashboard({
        requestConnect: () => Promise.reject(new DashboardError('not_found', 'No such machine.', 404)),
      }),
    });
    expect(await screen.findByText('The app')).toBeTruthy();
    connection.start();
    await waitFor(() => expect(devices.removed).toEqual(['k3x9']));
    expect((connection as Fleet).members).toEqual([]);
    expect(connection.listUnreachableMachines()).toEqual([]);
    view.unmount();
  });

  it('says to update Shinsa when every machine runs a protocol this page cannot work with', async () => {
    const outdated = spyOn(Fleet.prototype, 'isEveryMachineOutdated').mockReturnValue(true);
    renderRoot('/tasks', { devices: createDevices(DEVICE) });
    expect(await screen.findByText('Update Shinsa on Studio to reach it from here.')).toBeTruthy();
    expect(screen.getByText(/Studio runs a version of Shinsa this page cannot work with\./)).toBeTruthy();
    expect(screen.queryByText('The app')).toBeNull();
    outdated.mockRestore();
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
    renderRoot(`/enroll#k3x9.${MACHINE_KEY}.secret_1.tok`, {
      dashboard: createDashboard({ readSession: () => Promise.resolve({ user: null }) }),
    });
    const link = (await screen.findByText('Sign in with GitHub')).closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/__remote/sign-in?return=%2Fenroll');
    expect(location.hash).toBe('');
    expect(location.pathname).toBe('/enroll');
  });

  it('keeps a team link out of the address bar through sign-in, then shows the join page', async () => {
    const fragment = `team1.invite-1.${'A'.repeat(43)}`;
    const { unmount } = renderRoot(`/share/team#${fragment}`, {
      dashboard: createDashboard({ readSession: () => Promise.resolve({ user: null }) }),
    });
    const link = (await screen.findByText('Sign in with GitHub')).closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(`/__remote/sign-in?return=${encodeURIComponent('/share/team')}`);
    expect(location.hash).toBe('');
    unmount();
    renderRoot('/share/team');
    expect(await screen.findByText('Join a team')).toBeTruthy();
    sessionStorage.clear();
  });

  it('routes to the pair page and the enroll page', async () => {
    const { unmount } = renderRoot('/pair?code=K7PQ');
    expect(await screen.findByText('Pair Studio with your account')).toBeTruthy();
    unmount();
    renderRoot(`/enroll#k3x9.${MACHINE_KEY}.secret_1.tok`);
    expect(await screen.findByText('Add this device')).toBeTruthy();
  });

  it('routes to the claim page, keeping its link out of the address bar and the sign-in redirect', async () => {
    const { unmount } = renderRoot(`/claim#k3x9.${MACHINE_KEY}.secret_1.tok`, {
      dashboard: createDashboard({ readSession: () => Promise.resolve({ user: null }) }),
    });
    const link = (await screen.findByText('Sign in with GitHub')).closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/__remote/sign-in?return=%2Fclaim');
    expect(screen.getByText('Sign in to work on a task handed to you')).toBeTruthy();
    expect(screen.getByText('Still its owner’s task')).toBeTruthy();
    expect(screen.queryByText('Sign in to Shinsa')).toBeNull();
    expect(location.hash).toBe('');
    unmount();
    renderRoot('/claim', { dashboard: createDashboard({ listInstances: () => Promise.resolve([]) }) });
    expect(await screen.findByText('Work on a task handed to you')).toBeTruthy();
  });
});

describe('access requests in Settings → Machines', () => {
  it('lists the requests waiting on each machine, and nothing when none wait', () => {
    const request = {
      id: 'r1',
      publicKey: 'k',
      deviceName: 'Kai iPhone',
      user: { id: '7', login: 'kai', name: 'Kai Lane', avatarUrl: null },
      requestedAt: Date.now(),
    };
    const own = { ...request, id: 'r2', deviceName: 'Safari on iPad', user: STUDIO.owner };
    const remote = { requests: [request, own], access: null } as unknown as RemoteSnapshot;
    const shared = { ...STUDIO, id: 'w4t8', role: 'member' as const };
    const { unmount } = render(
      <MachineAccessRequests
        machines={[
          { id: 'k3x9', name: 'Studio', remote },
          { id: 'w4t8', name: 'Laptop', remote: { ...remote, requests: [own] } },
          { id: 'p7m2', name: 'Air', remote: null },
        ]}
        instances={[STUDIO, shared]}
      />
    );
    expect(screen.getByText('Access requests')).toBeTruthy();
    expect(screen.getByText('Waiting on Studio')).toBeTruthy();
    expect(screen.queryByText('Waiting on Air')).toBeNull();
    expect(screen.getByText('Kai Lane')).toBeTruthy();
    expect(screen.getAllByText('Safari on iPad')).toHaveLength(1);
    expect(screen.getByText('mona')).toBeTruthy();
    unmount();
    render(
      <MachineAccessRequests machines={[{ id: 'w4t8', name: 'Laptop', remote: null }]} instances={[]} />
    );
    expect(screen.queryByText('Access requests')).toBeNull();
  });
});

describe('the page after connecting Slack', () => {
  it('names the workspace and how the bot works, and opens Shinsa as its main action', async () => {
    renderRoot('/slack/linked?team=Overclock');
    expect(await screen.findByText('Slack is connected to Overclock')).toBeTruthy();
    expect(screen.getByText('Mention @Shinsa')).toBeTruthy();
    expect(screen.getByText('You decide in Shinsa')).toBeTruthy();
    const open = screen.getByText('Open Shinsa').closest('a');
    expect(open?.getAttribute('href')).toBe('/');
    expect(open?.getAttribute('data-variant') ?? open?.className).not.toContain('secondary');
  });

  it('says why connecting failed', async () => {
    renderRoot('/slack/linked?error=slack_denied');
    expect(await screen.findByText('Slack is not connected')).toBeTruthy();
    expect(
      screen.getByText('Slack was not connected because the request was turned down there.')
    ).toBeTruthy();
  });
});

describe('the machines in Settings', () => {
  it('lists every machine with whether it is in this dashboard, and removes one from the dashboard at once', async () => {
    const devices = createDevices(DEVICE);
    const dropped: string[] = [];
    replaceConnection({ ...connection, removeMachine: (id) => dropped.push(id) });
    try {
      render(
        <RemoteServicesContext.Provider
          value={{
            dashboard: createDashboard(),
            devices,
            teamKeys: createTeamKeys(),
            worker: createWorker(),
          }}
        >
          <MachinesSettings />
        </RemoteServicesContext.Provider>
      );
      expect(await screen.findByText(/In this dashboard/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      await waitFor(() => expect(devices.removed).toEqual(['k3x9']));
      expect(dropped).toEqual(['k3x9']);
    } finally {
      replaceConnection(null);
    }
  });

  it('names the task handed to you on a machine, and leaves it instead of removing it', async () => {
    const devices = createDevices(DEVICE);
    const left: string[] = [];
    const handed: RemoteInstance = {
      ...STUDIO,
      owner: { id: '3', login: 'lee', name: 'Lee Park', avatarUrl: null },
      role: 'guest',
    };
    const task = createTask({ id: 't1', title: 'Fix the tab bar' });
    const snapshot: Snapshot = { state: { ...createState(), tasks: { t1: task } }, status: 'open' };
    const machines: MachineChoice[] = [
      {
        id: 'k3x9',
        name: 'Studio',
        current: false,
        guest: true,
        state: { tasks: { t1: task }, projects: {}, repos: {}, settings: createState().settings },
      },
    ];
    replaceConnection(
      Object.assign(new Connection(), { snapshot: () => snapshot, listMachines: () => machines })
    );
    const dashboard = createDashboard({
      listInstances: () => Promise.resolve([handed]),
      leaveInstance: (instanceId) => {
        left.push(instanceId);
        return Promise.resolve({ ok: true });
      },
    });
    render(
      <RemoteServicesContext.Provider
        value={{ dashboard, devices, teamKeys: createTeamKeys(), worker: createWorker() }}
      >
        <MachinesSettings />
      </RemoteServicesContext.Provider>
    );
    expect(
      await screen.findByText('A task handed to you by Lee · In this dashboard · Fix the tab bar')
    ).toBeTruthy();
    expect(screen.queryByText('Task capacity')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(left).toEqual(['k3x9']));
    replaceConnection(null);
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
      <RemoteServicesContext.Provider
        value={{ dashboard, devices, teamKeys: createTeamKeys(), worker: createWorker() }}
      >
        <MachinesSettings />
      </RemoteServicesContext.Provider>
    );
    expect(await screen.findByText('Shared by Lee · In this dashboard')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(devices.removed).toEqual(['k3x9']));
    expect(left).toEqual(['k3x9']);
    expect(removed).toEqual([]);
  });

  it('shows each machine’s CPU, memory and disk, and opens to the open tasks using it', async () => {
    const local = connection;
    const task = createTask({ id: 'export', title: 'Retry exports' });
    const state = createShinsaState({ tasks: [task] });
    const machine: MachineChoice = {
      id: 'k3x9',
      name: 'Studio',
      current: true,
      state,
      resources: createMachineResources({ tasks: [createTaskResources({ taskId: 'export' })] }),
    };
    const machines = [machine];
    replaceConnection({
      ...local,
      snapshot: () => ({ state, status: 'open' }),
      listMachines: () => machines,
    });
    try {
      render(
        <RemoteServicesContext.Provider
          value={{
            dashboard: createDashboard(),
            devices: createDevices(DEVICE),
            teamKeys: createTeamKeys(),
            worker: createWorker(),
          }}
        >
          <MachinesSettings />
        </RemoteServicesContext.Provider>
      );
      const meters = await screen.findByRole('img', { name: 'CPU 20% · Memory 8 of 32 GB · 120 GB free' });
      expect(meters.textContent).toContain('CPU20%');
      expect(screen.queryByText('Retry exports')).toBeNull();
      expect(screen.queryByRole('button', { name: /open tasks on Studio/ })).toBeNull();
    } finally {
      replaceConnection(null);
    }
  });

  it('says a machine has no reading yet, then shows its meters', async () => {
    const local = connection;
    const state = createShinsaState({});
    const reading: MachineChoice = { id: 'k3x9', name: 'Studio', current: true, state, resources: null };
    const idle = { ...reading, resources: createMachineResources() };
    let machines = [reading];
    replaceConnection({
      ...local,
      snapshot: () => ({ state, status: 'open' }),
      listMachines: () => machines,
    });
    try {
      const { unmount } = render(
        <RemoteServicesContext.Provider
          value={{
            dashboard: createDashboard(),
            devices: createDevices(DEVICE),
            teamKeys: createTeamKeys(),
            worker: createWorker(),
          }}
        >
          <MachinesSettings />
        </RemoteServicesContext.Provider>
      );
      expect(await screen.findByText('No reading yet.')).toBeTruthy();
      unmount();
      machines = [idle];
      render(
        <RemoteServicesContext.Provider
          value={{
            dashboard: createDashboard(),
            devices: createDevices(DEVICE),
            teamKeys: createTeamKeys(),
            worker: createWorker(),
          }}
        >
          <MachinesSettings />
        </RemoteServicesContext.Provider>
      );
      expect(
        await screen.findByRole('img', { name: 'CPU 20% · Memory 8 of 32 GB · 120 GB free' })
      ).toBeTruthy();
      expect(screen.queryByText('No reading yet.')).toBeNull();
    } finally {
      replaceConnection(null);
    }
  });

  it('says when the machines cannot be read, and waits without the remote services', async () => {
    const { unmount } = render(
      <RemoteServicesContext.Provider
        value={{
          dashboard: createDashboard({ listInstances: () => Promise.reject(new Error('Signed out.')) }),
          devices: createDevices(),
          teamKeys: createTeamKeys(),
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
          teamKeys: createTeamKeys(),
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
    invite: 'invite-token',
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
    const field = (await screen.findByLabelText('Device name')) as HTMLInputElement;
    expect(field.value).toBe('Chrome on Mac');
    expect(screen.getByText('Add this device')).toBeTruthy();
    fireEvent.change(field, { target: { value: ' Work Mac ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByText('Request sent. Accept it on the machine.')).toBeTruthy();
    const waitingButton = screen.getByRole('button', { name: 'Waiting for an answer' });
    expect(waitingButton.hasAttribute('disabled')).toBe(true);
    expect(waitingButton.querySelector('[data-slot="spinner"], .animate-spin')).toBeNull();
    expect(asked).toEqual(['Work Mac']);
    finish();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(sessionStorage.getItem('shinsa.remote.enroll')).toBeNull();
  });

  it('asks to join someone else’s machine under a name with the GitHub name in front', async () => {
    const seen: (RemoteUser | null)[] = [];
    render(
      <EnrollPage
        link={link}
        user={USER.user as RemoteUser}
        dashboard={createDashboard({ listInstances: () => Promise.reject(new Error('Offline.')) })}
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
    expect(await screen.findByText('Join a shared machine')).toBeTruthy();
    expect(seen.at(-1)).toEqual(USER.user);
    fireEvent.change(screen.getByLabelText('Device name'), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: 'Request access' }).hasAttribute('disabled')).toBe(true);
    fireEvent.submit(screen.getByLabelText('Device name'));
    expect(screen.queryByText(/Request sent/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Device name'), { target: { value: 'Mona iPhone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByText('Request sent. You can close this page.')).toBeTruthy();
  });

  it('picks up the request this device already sent, and says when it is already added', async () => {
    const earlier = {
      instanceId: 'k3x9',
      machineKey: MACHINE_KEY,
      keys: {} as CryptoKeyPair,
      enrolledAt: 1,
      waiting: { machineName: 'Studio', deviceName: 'Work Mac' },
    };
    const asked: { name: string; earlier: EnrolledDevice | null | undefined }[] = [];
    const { unmount } = render(
      <EnrollPage
        link={link}
        user={USER.user as RemoteUser}
        dashboard={createDashboard()}
        devices={createDevices(earlier)}
        resolveName={() => 'Chrome on Mac'}
        request={(_input, options) => {
          asked.push({ name: options.name, earlier: options.earlier });
          return new Promise(() => undefined);
        }}
      />
    );
    expect(await screen.findByText('Request sent. Accept it on the machine.')).toBeTruthy();
    expect(((await screen.findByLabelText('Device name')) as HTMLInputElement).value).toBe('Work Mac');
    expect(asked).toEqual([{ name: 'Work Mac', earlier }]);
    unmount();
    const { waiting: _waiting, ...added } = earlier;
    const second = render(
      <EnrollPage
        link={link}
        user={USER.user as RemoteUser}
        dashboard={createDashboard()}
        devices={createDevices(added)}
        resolveName={() => 'Chrome on Mac'}
      />
    );
    expect(await screen.findByText('This device is already added')).toBeTruthy();
    second.unmount();
    render(
      <EnrollPage
        link={link}
        user={USER.user as RemoteUser}
        dashboard={createDashboard()}
        devices={{ ...createDevices(), selectDevice: () => Promise.reject(new Error('No storage.')) }}
        resolveName={() => 'Chrome on Mac'}
      />
    );
    expect(await screen.findByRole('button', { name: 'Request access' })).toBeTruthy();
  });

  it('asks again with a new key when the machine it was added to no longer lists this account', async () => {
    const asked: (EnrolledDevice | null | undefined)[] = [];
    render(
      <EnrollPage
        link={link}
        user={USER.user as RemoteUser}
        dashboard={createDashboard({ listInstances: () => Promise.resolve([]) })}
        devices={createDevices({
          instanceId: 'k3x9',
          machineKey: MACHINE_KEY,
          keys: {} as CryptoKeyPair,
          enrolledAt: 1,
        })}
        resolveName={() => 'Mona iPhone'}
        request={(_input, options) => {
          asked.push(options.earlier);
          return new Promise(() => undefined);
        }}
      />
    );
    expect(await screen.findByText('Join a shared machine')).toBeTruthy();
    expect(screen.queryByText('This device is already added')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    expect(asked).toEqual([null]);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Request access' }));
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

describe('the claim page', () => {
  const link = {
    instanceId: 'k3x9',
    machineKey: MACHINE_KEY,
    secret: 'secret_1',
    invite: 'handoff-token',
    onMachine: false,
  };
  const KAI: RemoteUser = { id: '2', login: 'kai', name: null, avatarUrl: null };

  it('takes the task over under this browser’s name, then opens Shinsa', async () => {
    sessionStorage.setItem('shinsa.remote.enroll', 'x');
    const named: string[] = [];
    render(
      <ClaimPage
        link={link}
        user={KAI}
        dashboard={createDashboard({ listInstances: () => Promise.resolve([]) })}
        devices={createDevices()}
        resolveName={(user) => `${user.login}’s Chrome`}
        claim={(_input, options) => {
          named.push(options.name);
          return Promise.resolve({} as EnrolledDevice);
        }}
      />
    );
    expect(await screen.findByText('Work on a task handed to you')).toBeTruthy();
    expect(screen.getByText('This one task')).toBeTruthy();
    expect(
      screen.getByText('As @kai. Only the first account to open this link gets this task.')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Work on this task' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(named).toEqual(['kai’s Chrome']);
    expect(sessionStorage.getItem('shinsa.remote.enroll')).toBeNull();
  });

  it('says why it could not take the task over', async () => {
    render(
      <ClaimPage
        link={link}
        user={KAI}
        dashboard={createDashboard({ listInstances: () => Promise.reject(new Error('Offline.')) })}
        devices={createDevices()}
        resolveName={() => 'Chrome'}
        claim={() =>
          Promise.reject(
            new Error('Someone else already opened this hand-off link. Ask the task’s owner for a new one.')
          )
        }
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Work on this task' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Someone else already opened this hand-off link. Ask the task’s owner for a new one.'
    );
  });

  it('leaves the link for someone else on a device that reaches the machine, or already works on one of its tasks', async () => {
    const device = { instanceId: 'k3x9', machineKey: MACHINE_KEY, enrolledAt: 1 } as EnrolledDevice;
    const failing = { ...createDevices(device), selectDevice: () => Promise.reject(new Error('Closed.')) };
    const { unmount } = render(
      <ClaimPage link={link} user={KAI} dashboard={createDashboard()} devices={createDevices(device)} />
    );
    expect(await screen.findByText('This device already reaches Studio')).toBeTruthy();
    unmount();
    const second = render(
      <ClaimPage
        link={link}
        user={KAI}
        dashboard={createDashboard({ listInstances: () => Promise.resolve([{ ...STUDIO, role: 'guest' }]) })}
        devices={createDevices(device)}
      />
    );
    expect(await screen.findByText('This browser works on a task from there already')).toBeTruthy();
    second.unmount();
    render(<ClaimPage link={link} user={KAI} dashboard={createDashboard()} devices={failing} />);
    expect(await screen.findByText('Work on a task handed to you')).toBeTruthy();
  });

  it('says a link that cannot work is incomplete', () => {
    render(<ClaimPage link={null} user={KAI} dashboard={createDashboard()} devices={createDevices()} />);
    expect(screen.getByText('This link cannot hand over a task')).toBeTruthy();
  });
});
