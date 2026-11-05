import { describe, expect, it, mock } from 'bun:test';
import { type RemoteInstance, serializePublicKey } from '@shinsa/core';
import { Effect } from 'effect';
import { openRemoteChannel } from '@/lib/remote/channel.ts';
import { describeMachine } from '@/lib/remote/machines.ts';
import type { EnrolledDevice } from '@/lib/remote/schema.ts';
import {
  COMMANDS_PATH,
  countJoinPicks,
  createJoinMachine,
  createJoinMachinesSource,
  createJoinMember,
  describeJoinPicks,
  JOIN_PATH,
  listJoinCommands,
  listJoinRows,
  PROJECTS_PATH,
  joinFromMachines,
  resolveJoinSetup,
} from '@/lib/teams/join-machines.ts';
import { createProject } from '../../support/state.ts';
import { createKeyPair, FakeMac } from '../remote/fake-mac.ts';

const MONA = { id: '1', login: 'mona', name: null, avatarUrl: null };

const STUDIO: RemoteInstance = {
  id: 'k3x9',
  name: 'Studio',
  fingerprint: 'abcd',
  online: true,
  lastSeenAt: 1,
  createdAt: 0,
  owner: MONA,
  role: 'owner',
};

const LAPTOP: RemoteInstance = { ...STUDIO, id: 'p7m2', name: 'Laptop' };

const SHARED: RemoteInstance = { ...STUDIO, id: 'q1w2', name: 'Kai’s Mac', role: 'member' };

const PROJECTS = [createProject({ id: 'web', name: 'Web' }), createProject({ id: 'api', name: 'Api' })];

const CHOICES = [
  { id: 'api', name: 'Api', color: 'blue' },
  { id: 'web', name: 'Web', color: 'blue' },
];

const ORIGIN = 'https://app.shinsa.dev';

const OPEN_SOCKET = () => ({}) as WebSocket;

const DEVICES = { writeDevice: () => Promise.resolve(), removeDevice: () => Promise.resolve() };

const URL = 'https://app.shinsa.dev/share/team#team1.invite.key';

function createDevice(instanceId: string, extra: Partial<EnrolledDevice> = {}): EnrolledDevice {
  return { instanceId, machineKey: 'key', keys: {} as CryptoKeyPair, enrolledAt: 1, ...extra };
}

function answerProjects(request: Request) {
  if (new globalThis.URL(request.url).pathname === PROJECTS_PATH) {
    return Promise.resolve(Response.json({ projects: PROJECTS, focus: null }));
  }
  return Promise.reject(new Error('unused'));
}

describe('the machines the join page shares from', () => {
  it('keeps only your own online machines this browser was added to and is not waiting on', () => {
    const rows = [
      describeMachine(STUDIO, createDevice(STUDIO.id), Date.now()),
      describeMachine(LAPTOP, createDevice(LAPTOP.id, { waiting: { machineName: 'Laptop' } }), Date.now()),
      describeMachine(SHARED, createDevice(SHARED.id), Date.now()),
      describeMachine({ ...STUDIO, id: 'none' }, null, Date.now()),
      describeMachine(
        { ...STUDIO, id: 'z8v4', name: 'Mini', online: false },
        createDevice('z8v4'),
        Date.now()
      ),
    ];
    expect(listJoinRows(rows).map((row) => row.instance.name)).toEqual(['Studio']);
  });

  it('adds each picked project to the team once', () => {
    expect(listJoinCommands('team1', ['web', 'web', 'api'])).toEqual([
      { type: 'project.add_to_team', projectId: 'web', teamId: 'team1' },
      { type: 'project.add_to_team', projectId: 'api', teamId: 'team1' },
    ]);
  });
});

describe('what the join page needs set up first', () => {
  const at = Date.now();
  const row = (instance: RemoteInstance, device: EnrolledDevice | null) =>
    describeMachine(instance, device, at);

  it('asks to pair a machine when the account has none of its own', () => {
    expect(resolveJoinSetup([], 0)).toEqual({ kind: 'pair' });
    expect(resolveJoinSetup([row(SHARED, createDevice(SHARED.id))], 0)).toEqual({ kind: 'pair' });
  });

  it('needs nothing once a machine is reached', () => {
    expect(resolveJoinSetup([row(STUDIO, null), row(LAPTOP, createDevice(LAPTOP.id))], 1)).toBeNull();
  });

  it('waits on a request first, then asks to add this browser, then to open an offline machine', () => {
    const waiting = createDevice(LAPTOP.id, { waiting: { machineName: 'Laptop' } });
    expect(resolveJoinSetup([row(STUDIO, null), row(LAPTOP, waiting)], 0)).toEqual({
      kind: 'waiting',
      machines: ['Laptop'],
    });
    expect(resolveJoinSetup([row(STUDIO, null), row(LAPTOP, createDevice(LAPTOP.id))], 0)).toEqual({
      kind: 'add',
      machines: ['Studio'],
    });
    expect(
      resolveJoinSetup([row({ ...STUDIO, online: false }, createDevice(STUDIO.id)), row(SHARED, null)], 0)
    ).toEqual({ kind: 'offline', machines: ['Studio'] });
  });
});

describe('joining from a machine', () => {
  it('joins with the link even without a pick, then adds each pick through the machine’s commands', async () => {
    const requests: Request[] = [];
    const machine = createJoinMachine(
      {
        id: 'k3x9',
        name: 'Studio',
        fetch: (request) => {
          requests.push(request);
          const joining = new globalThis.URL(request.url).pathname === JOIN_PATH;
          return Promise.resolve(
            Response.json(joining ? { teamId: 'team1', status: 'requested' } : { ok: true, taskId: null })
          );
        },
      },
      CHOICES,
      ORIGIN
    );
    await machine.join(URL, []);
    expect(requests.map((request) => request.url)).toEqual([`${ORIGIN}${JOIN_PATH}`]);
    await machine.join(URL, ['web']);
    expect(requests.map((request) => request.url)).toEqual([
      `${ORIGIN}${JOIN_PATH}`,
      `${ORIGIN}${JOIN_PATH}`,
      `${ORIGIN}${COMMANDS_PATH}`,
    ]);
    expect(await requests[0]?.json()).toEqual({ url: URL });
    expect(await requests[2]?.json()).toEqual({
      type: 'project.add_to_team',
      projectId: 'web',
      teamId: 'team1',
    });
  });

  it('says what the machine refused, or its status when it says nothing', async () => {
    const refusing = (...responses: Response[]) =>
      createJoinMachine(
        { id: 'k3x9', name: 'Studio', fetch: () => Promise.resolve(responses.shift() as Response) },
        CHOICES,
        ORIGIN
      );
    await expect(
      refusing(Response.json({ error: { message: 'This team link was turned off.' } }, { status: 404 })).join(
        URL,
        ['web']
      )
    ).rejects.toThrow('This team link was turned off.');
    await expect(refusing(new Response('down', { status: 502 })).join(URL, ['web'])).rejects.toThrow(
      'Shinsa answered with status 502.'
    );
    await expect(refusing(Response.json({ status: 'requested' })).join(URL, ['web'])).rejects.toThrow(
      'Shinsa sent an answer this page can’t read.'
    );
    await expect(
      refusing(
        Response.json({ teamId: 'team1' }),
        Response.json({ error: { message: 'No project web.' } }, { status: 400 })
      ).join(URL, ['web'])
    ).rejects.toThrow('No project web.');
  });
});

describe('opening your machines for the join page', () => {
  it('reads each machine’s projects, skips one that never answers, and closes them all', async () => {
    const closed: string[] = [];
    const open = createJoinMachinesSource(
      {
        dashboard: {
          listInstances: () => Promise.resolve([STUDIO, LAPTOP, { ...STUDIO, id: 'f4n1', name: 'Mini' }]),
          requestConnect: () => Promise.reject(new Error('unused')),
        },
        devices: { ...DEVICES, selectDevice: (id) => Promise.resolve(createDevice(id)) },
      },
      {
        origin: ORIGIN,
        openSocket: OPEN_SOCKET,
        timeout: '20 millis',
        createMember: (row) => ({
          member: {
            id: row.instance.id,
            name: row.instance.name,
            fetch: (request) => {
              if (row.instance.id === 'p7m2') return new Promise<Response>(() => undefined);
              if (row.instance.id === 'f4n1') return Promise.reject(new Error('refused'));
              return answerProjects(request);
            },
          },
          close: () => closed.push(row.instance.id),
        }),
      }
    );
    const opened = await open();
    expect(opened.machines.map((machine) => [machine.name, machine.projects])).toEqual([['Studio', CHOICES]]);
    expect(opened.setup).toBeNull();
    opened.close();
    opened.close();
    expect(closed).toEqual(['k3x9', 'p7m2', 'f4n1']);
  });

  it('reads the projects over the sealed channel, and stops once the machine refuses this browser', async () => {
    const keys = await createKeyPair();
    const mac = await FakeMac.create({
      enrolled: [await Effect.runPromise(serializePublicKey(keys.publicKey))],
      respond: answerProjects,
    });
    const device: EnrolledDevice = { instanceId: STUDIO.id, machineKey: mac.machineKey, keys, enrolledAt: 1 };
    const connect = () => Promise.resolve({ url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 });
    const open = createJoinMachinesSource(
      {
        dashboard: { listInstances: () => Promise.resolve([STUDIO]), requestConnect: connect },
        devices: { ...DEVICES, selectDevice: () => Promise.resolve(device) },
      },
      {
        origin: ORIGIN,
        openSocket: OPEN_SOCKET,
        createMember: (row, dashboard) =>
          createJoinMember(row, dashboard, (options) =>
            openRemoteChannel({ ...options, openSocket: mac.openSocket })
          ),
      }
    );
    const opened = await open();
    expect(opened.machines.map((machine) => machine.projects)).toEqual([CHOICES]);
    opened.close();
    mac.enrolled.clear();
    const refused = createJoinMember(
      { ...describeMachine(STUDIO, device, Date.now()), device },
      { requestConnect: connect },
      (options) => openRemoteChannel({ ...options, openSocket: mac.openSocket })
    );
    await expect(refused.member.fetch(new Request(`${ORIGIN}${PROJECTS_PATH}`))).rejects.toThrow(
      'not enrolled'
    );
    refused.close();
  });

  it('settles a waiting request before it decides, and asks to open machines that never answer', async () => {
    const waiting = createDevice(STUDIO.id, { waiting: { machineName: 'Studio' } });
    const open = createJoinMachinesSource(
      {
        dashboard: {
          listInstances: () => Promise.resolve([STUDIO]),
          requestConnect: () => Promise.reject(new Error('offline')),
        },
        devices: { ...DEVICES, selectDevice: () => Promise.resolve(waiting) },
      },
      { origin: ORIGIN, openSocket: OPEN_SOCKET }
    );
    expect((await open()).setup).toEqual({ kind: 'waiting', machines: ['Studio'] });
    const silent = createJoinMachinesSource(
      {
        dashboard: {
          listInstances: () => Promise.resolve([STUDIO]),
          requestConnect: () => Promise.reject(new Error('unused')),
        },
        devices: { ...DEVICES, selectDevice: (id) => Promise.resolve(createDevice(id)) },
      },
      {
        origin: ORIGIN,
        openSocket: OPEN_SOCKET,
        createMember: (row) => ({
          member: {
            id: row.instance.id,
            name: row.instance.name,
            fetch: () => Promise.reject(new Error('gone')),
          },
          close: () => undefined,
        }),
      }
    );
    expect((await silent()).setup).toEqual({ kind: 'offline', machines: ['Studio'] });
  });

  it('asks to pair when the account has none of its own here', async () => {
    const open = createJoinMachinesSource(
      {
        dashboard: {
          listInstances: () => Promise.resolve([SHARED]),
          requestConnect: () => Promise.reject(new Error('unused')),
        },
        devices: { ...DEVICES, selectDevice: () => Promise.resolve(null) },
      },
      { openSocket: OPEN_SOCKET }
    );
    const opened = await open();
    expect(opened.machines).toEqual([]);
    expect(opened.setup).toEqual({ kind: 'pair' });
  });
});

describe('what the join page picked', () => {
  const machines = [
    createJoinMachine(
      { id: 'k3x9', name: 'Studio', fetch: () => Promise.resolve(Response.json({ teamId: 'team1' })) },
      CHOICES,
      ORIGIN
    ),
  ];

  it('counts the picks, says what you share, and joins every machine with its picks', async () => {
    expect(countJoinPicks({})).toBe(0);
    expect(countJoinPicks({ k3x9: ['web', 'api'], p7m2: ['x'] })).toBe(3);
    expect(describeJoinPicks(machines, {})).toBeNull();
    expect(describeJoinPicks(machines, { k3x9: ['web', 'api'] })).toBe(
      'You share Api and Web with the team.'
    );
    const join = mock(() => Promise.resolve());
    await joinFromMachines([{ ...machines[0], join } as (typeof machines)[number]], { k3x9: ['web'] }, URL);
    await joinFromMachines([{ ...machines[0], id: 'other', join } as (typeof machines)[number]], {}, URL);
    expect(join.mock.calls).toEqual([
      [URL, ['web']],
      [URL, []],
    ] as never);
  });
});
