import { describe, expect, it } from 'bun:test';
import { type RemoteInstance, type RemoteTeam, resolveKeyFingerprint } from '@shinsa/core';
import type { ChannelOptions, RemoteChannel } from '@/lib/remote/channel.ts';
import type { EnrolledDevice } from '@/lib/remote/devices.ts';
import { describeMachine } from '@/lib/remote/machines.ts';
import { admitTeamMachines, readTeamMachineGrant } from '@/lib/teams/admit.ts';
import type { TeamChannelHandlers, TeamChannelTarget } from '@/lib/teams/channel.ts';
import { createKeyPair } from '../remote/fake-mac.ts';
import { TEAM_KEY } from './machine.ts';

const MACHINE_KEY = 'machine-public-key';

const MONA = { id: '1', login: 'mona', name: null, avatarUrl: null };

const KAI = { id: '7', login: 'kai', name: null, avatarUrl: null };

function createInstance(overrides: Partial<RemoteInstance> = {}): RemoteInstance {
  return {
    id: 'studio',
    name: 'Studio',
    fingerprint: '',
    online: true,
    lastSeenAt: 1,
    createdAt: 0,
    owner: MONA,
    role: 'member',
    ...overrides,
  };
}

const TEAM: RemoteTeam = {
  id: 'team1',
  name: 'Platform',
  owner: MONA,
  role: 'member',
  members: [{ user: KAI, addedAt: 1 }],
  requests: [],
  machines: [{ id: 'studio', name: 'Studio', userId: MONA.id, online: true, lastSeenAt: 1 }],
  createdAt: 1,
};

const GRANT = 'grant-secret';

function sendView(machineKey: string | undefined, grant: string | null = GRANT) {
  return (_target: TeamChannelTarget, handlers: TeamChannelHandlers) => {
    handlers.onMessage({ t: 'view', data: JSON.stringify({ tasks: [], machineKey, grant, updatedAt: 1 }) });
    return () => undefined;
  };
}

function setUp(
  options: { refuse?: boolean; teams?: RemoteTeam[]; key?: string | null; grant?: string | null } = {}
) {
  const written: EnrolledDevice[] = [];
  const opened: ChannelOptions[] = [];
  const admit = {
    dashboard: {
      listTeams: () => Promise.resolve(options.teams ?? [TEAM]),
      requestConnect: () =>
        Promise.resolve({ url: 'wss://t-studio.shinsa.dev/remote?token=t', expiresAt: 9 }),
    },
    devices: {
      writeDevice: (device: EnrolledDevice) => {
        written.push(device);
        return Promise.resolve();
      },
    },
    selectTeamKey: () =>
      Promise.resolve(
        options.key === null
          ? null
          : { teamId: 'team1', name: 'Platform', key: options.key ?? TEAM_KEY, joinedAt: 1 }
      ),
    name: 'Kai’s Mac',
    openTeam: sendView(MACHINE_KEY, options.grant === undefined ? GRANT : options.grant),
    openChannel: (channel: ChannelOptions) => {
      opened.push(channel);
      if (options.refuse) return Promise.reject(new Error('refused'));
      return Promise.resolve({ close: () => undefined } as unknown as RemoteChannel);
    },
    createKeys: createKeyPair,
    now: () => 5,
  };
  return { admit, written, opened };
}

describe('adding this browser to a teammate’s machine', () => {
  it('adds a machine with the grant only its owner’s machine sends you, pinned to the key the team channel sends', async () => {
    const instance = createInstance({ fingerprint: await resolveKeyFingerprint(MACHINE_KEY) });
    const { admit, written, opened } = setUp();
    const [row] = await admitTeamMachines([describeMachine(instance, null)], admit);
    expect(row?.device).toMatchObject({ instanceId: 'studio', machineKey: MACHINE_KEY, enrolledAt: 5 });
    expect(written).toHaveLength(1);
    expect(opened[0]).toMatchObject({ machineKey: MACHINE_KEY, enrollSecret: GRANT, name: 'Kai’s Mac' });
  });

  it('leaves a machine alone when its key does not match the fingerprint app.shinsa.dev lists', async () => {
    const { admit, written } = setUp();
    const [row] = await admitTeamMachines(
      [describeMachine(createInstance({ fingerprint: 'nope' }), null)],
      admit
    );
    expect(row?.device).toBeNull();
    expect(written).toEqual([]);
  });

  it('writes nothing when the machine refuses or sends no grant, this browser has no key, or no team lists it', async () => {
    const fingerprint = await resolveKeyFingerprint(MACHINE_KEY);
    const row = describeMachine(createInstance({ fingerprint }), null);
    for (const options of [
      { refuse: true },
      { key: null },
      { grant: null },
      { teams: [{ ...TEAM, machines: [] }] },
    ]) {
      const { admit, written } = setUp(options);
      expect((await admitTeamMachines([row], admit))[0]?.device).toBeNull();
      expect(written).toEqual([]);
    }
  });

  it('touches only machines shared with you that this browser lacks and that are online', async () => {
    const { admit, written } = setUp();
    let listed = 0;
    const counting = {
      ...admit,
      dashboard: {
        ...admit.dashboard,
        listTeams: () => {
          listed += 1;
          return Promise.resolve([TEAM]);
        },
      },
    };
    const rows = [
      describeMachine(createInstance({ role: 'owner' }), null),
      describeMachine(createInstance({ online: false }), null),
    ];
    expect(await admitTeamMachines(rows, counting)).toBe(rows);
    expect(listed).toBe(0);
    expect(written).toEqual([]);
  });

  it('keeps the rows as they were when the teams cannot be read', async () => {
    const { admit } = setUp();
    const rows = [describeMachine(createInstance(), null)];
    const failing = {
      ...admit,
      dashboard: { ...admit.dashboard, listTeams: () => Promise.reject(new Error('down')) },
    };
    expect(await admitTeamMachines(rows, failing)).toBe(rows);
  });

  it('reads the machine key and grant from the first view, or nothing without both or when the channel ends first', async () => {
    const target: TeamChannelTarget = {
      teamId: 'team1',
      instanceId: 'studio',
      key: TEAM_KEY,
      view: { kind: 'list' },
    };
    expect(await readTeamMachineGrant(target, sendView('k'))).toEqual({ machineKey: 'k', grant: GRANT });
    expect(await readTeamMachineGrant(target, sendView(undefined))).toBeNull();
    let stopped = 0;
    const ended = await readTeamMachineGrant(target, (_target, handlers) => {
      setTimeout(() => {
        handlers.onMessage({ t: 'closed', reason: 'gone' });
        handlers.onEnd({ reason: 'gone', gone: true });
        handlers.onEnd({ reason: 'again', gone: true });
      }, 0);
      return () => {
        stopped += 1;
      };
    });
    expect(ended).toBeNull();
    expect(stopped).toBe(1);
  });
});
