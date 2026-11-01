import { describe, expect, it, mock } from 'bun:test';
import type { RemoteInstance, UserCommand, WireState } from '@shinsa/core';
import { waitFor } from '@testing-library/react';
import { openRemoteChannel } from '@/lib/remote/channel.ts';
import type { EnrolledDevice } from '@/lib/remote/devices.ts';
import { describeMachine } from '@/lib/remote/machines.ts';
import { createSignal } from '@/lib/signal.ts';
import {
  countJoinPicks,
  createJoinMachine,
  createJoinMachinesSource,
  createJoinMember,
  describeJoinPicks,
  JOIN_PATH,
  listJoinCommands,
  listJoinRows,
  shareJoinPicks,
  waitForState,
} from '@/lib/teams/join-machines.ts';
import { createProject, createShinsaState } from '../../support/state.ts';
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

const STATE = createShinsaState({
  projects: [createProject({ id: 'web', name: 'Web' }), createProject({ id: 'api', name: 'Api' })],
}) as unknown as WireState;

const URL = 'https://app.shinsa.dev/share/team#team1.invite.key';

function createDevice(instanceId: string, extra: Partial<EnrolledDevice> = {}): EnrolledDevice {
  return { instanceId, machineKey: 'key', keys: {} as CryptoKeyPair, enrolledAt: 1, ...extra };
}

function createFakeConnection(state: WireState | null) {
  const signal = createSignal();
  let current = state;
  const commands: UserCommand[] = [];
  return {
    commands,
    start: mock(() => undefined),
    subscribe: signal.subscribe,
    snapshot: () => ({ state: current, status: 'open' as const }),
    command: (command: UserCommand) => {
      commands.push(command);
      return Promise.resolve();
    },
    publish(next: WireState) {
      current = next;
      signal.publish();
    },
  };
}

describe('the machines the join page shares from', () => {
  it('keeps only your own machines this browser was added to and is not waiting on', () => {
    const rows = [
      describeMachine(STUDIO, createDevice(STUDIO.id)),
      describeMachine(LAPTOP, createDevice(LAPTOP.id, { waiting: { machineName: 'Laptop' } })),
      describeMachine(SHARED, createDevice(SHARED.id)),
      describeMachine({ ...STUDIO, id: 'none' }, null),
    ];
    expect(listJoinRows(rows).map((row) => row.instance.name)).toEqual(['Studio']);
  });

  it('waits for a machine’s state, and gives up after its time', async () => {
    expect(await waitForState(createFakeConnection(STATE), 1000)).toBe(STATE);
    const later = createFakeConnection(null);
    const waiting = waitForState(later, 1000);
    later.publish(STATE);
    expect(await waiting).toBe(STATE);
    expect(await waitForState(createFakeConnection(null), 5)).toBeNull();
  });

  it('adds each picked project to the team once', () => {
    expect(listJoinCommands('team1', ['web', 'web', 'api'])).toEqual([
      { type: 'project.add_to_team', projectId: 'web', teamId: 'team1' },
      { type: 'project.add_to_team', projectId: 'api', teamId: 'team1' },
    ]);
  });
});

describe('sharing projects from a machine', () => {
  it('lists its projects, joins with the link, then adds what you picked', async () => {
    const connection = createFakeConnection(STATE);
    const requests: Request[] = [];
    const machine = createJoinMachine(
      {
        id: 'k3x9',
        name: 'Studio',
        fetch: (request) => {
          requests.push(request);
          return Promise.resolve(Response.json({ teamId: 'team1', status: 'requested' }));
        },
      },
      connection,
      STATE,
      'https://app.shinsa.dev'
    );
    expect(machine.projects.map((project) => project.name)).toEqual(['Api', 'Web']);
    await machine.share(URL, []);
    expect(requests).toEqual([]);
    await machine.share(URL, ['web']);
    expect(requests[0]?.url).toBe(`https://app.shinsa.dev${JOIN_PATH}`);
    expect(await requests[0]?.json()).toEqual({ url: URL });
    expect(connection.commands).toEqual([{ type: 'project.add_to_team', projectId: 'web', teamId: 'team1' }]);
  });

  it('says what the machine refused, or its status when it says nothing', async () => {
    const refusing = (response: Response) =>
      createJoinMachine(
        { id: 'k3x9', name: 'Studio', fetch: () => Promise.resolve(response) },
        createFakeConnection(STATE),
        STATE,
        'https://app.shinsa.dev'
      );
    await expect(
      refusing(
        Response.json({ error: { message: 'This team link was turned off.' } }, { status: 404 })
      ).share(URL, ['web'])
    ).rejects.toThrow('This team link was turned off.');
    await expect(refusing(new Response('down', { status: 502 })).share(URL, ['web'])).rejects.toThrow(
      'Shinsa answered with status 502.'
    );
  });
});

describe('opening your machines for the join page', () => {
  it('reads each machine’s projects, skips one that never answers, and closes them all', async () => {
    const closed: string[] = [];
    const connections = new Map([
      ['k3x9', createFakeConnection(STATE)],
      ['p7m2', createFakeConnection(null)],
    ]);
    const open = createJoinMachinesSource(
      {
        dashboard: {
          listInstances: () => Promise.resolve([STUDIO, LAPTOP]),
          requestConnect: () => Promise.reject(new Error('unused')),
        },
        devices: { selectDevice: (id) => Promise.resolve(createDevice(id)) },
      },
      {
        origin: 'https://app.shinsa.dev',
        timeoutMs: 5,
        createMember: (row) => ({
          member: {
            id: row.instance.id,
            name: row.instance.name,
            fetch: () => Promise.reject(new Error('unused')),
            connection: connections.get(row.instance.id) ?? createFakeConnection(null),
          },
          close: () => closed.push(row.instance.id),
        }),
      }
    );
    const opened = await open();
    expect(opened.machines.map((machine) => machine.name)).toEqual(['Studio']);
    expect(connections.get('k3x9')?.start).toHaveBeenCalled();
    opened.close();
    opened.close();
    expect(closed).toEqual(['k3x9', 'p7m2']);
  });

  it('builds its own connection, and stops trying once the machine refuses this browser', async () => {
    const mac = await FakeMac.create({ enrolled: [] });
    const device: EnrolledDevice = {
      instanceId: STUDIO.id,
      machineKey: mac.machineKey,
      keys: await createKeyPair(),
      enrolledAt: 1,
    };
    const { member } = createJoinMember(
      { ...describeMachine(STUDIO, device), device },
      { requestConnect: () => Promise.resolve({ url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 }) },
      (options) => openRemoteChannel({ ...options, openSocket: mac.openSocket })
    );
    await expect(member.fetch(new Request('https://shinsa.dev/api/health'))).rejects.toThrow('not enrolled');
    member.connection.start();
    await waitFor(() => expect(member.connection.snapshot().status).toBe('closed'));
  });

  it('offers no machine when the account has none of its own here', async () => {
    const open = createJoinMachinesSource({
      dashboard: {
        listInstances: () => Promise.resolve([SHARED]),
        requestConnect: () => Promise.reject(new Error('unused')),
      },
      devices: { selectDevice: () => Promise.resolve(null) },
    });
    expect((await open()).machines).toEqual([]);
  });
});

describe('what the join page picked', () => {
  const machines = [
    createJoinMachine(
      { id: 'k3x9', name: 'Studio', fetch: () => Promise.resolve(Response.json({ teamId: 'team1' })) },
      createFakeConnection(STATE),
      STATE,
      'https://app.shinsa.dev'
    ),
  ];

  it('counts the picks, says what you share, and shares from every machine', async () => {
    expect(countJoinPicks({})).toBe(0);
    expect(countJoinPicks({ k3x9: ['web', 'api'], p7m2: ['x'] })).toBe(3);
    expect(describeJoinPicks(machines, {})).toBeNull();
    expect(describeJoinPicks(machines, { k3x9: ['web', 'api'] })).toBe(
      'You share Api and Web with the team.'
    );
    const share = mock(() => Promise.resolve());
    await shareJoinPicks([{ ...machines[0], share } as (typeof machines)[number]], { k3x9: ['web'] }, URL);
    await shareJoinPicks([{ ...machines[0], id: 'other', share } as (typeof machines)[number]], {}, URL);
    expect(share.mock.calls).toEqual([
      [URL, ['web']],
      [URL, []],
    ] as never);
  });
});
