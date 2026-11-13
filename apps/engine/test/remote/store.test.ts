import { describe, expect, test } from 'bun:test';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_TEAM_SCOPES } from '@shinsa/core';
import { readTeams } from '../../src/remote/store/decode.ts';
import { listTeamEntries, resolveOwnerProfile } from '../../src/remote/store/derive.ts';
import { createTempDir } from '../helpers/index.ts';
import { captureLogs } from '../helpers/logs.ts';
import { openTestStore, readRemoteFile } from './harness.ts';

const CREDENTIALS = {
  instanceId: 'k3x9',
  machineToken: 'machine',
  connectKey: 'AAAA',
};

function createPath() {
  return join(createTempDir(), 'remote.json');
}

describe('remote.json', () => {
  test('reads as not paired when it is missing, broken or not an object', async () => {
    const path = createPath();
    expect((await readRemoteFile(path)).credentials).toBeNull();
    const logs = captureLogs();
    writeFileSync(path, '{');
    expect((await readRemoteFile(path)).enabled).toBe(false);
    writeFileSync(path, '[]');
    expect((await readRemoteFile(path)).devices).toEqual([]);
    logs.restore();
    expect(logs.fieldsOf('[Remote] remote.json could not be read; remote access is off')).toHaveLength(1);
  });

  test('reads a paired file and drops what it cannot use, a device with no account included', async () => {
    const path = createPath();
    writeFileSync(
      path,
      JSON.stringify({
        machine: { publicKey: 'p', privateKey: 'k' },
        credentials: CREDENTIALS,
        owner: 'mona',
        enabled: true,
        devices: [
          {
            publicKey: 'd1',
            name: 'Phone',
            enrolledAt: 1,
            lastSeenAt: 2,
            userId: '7',
          },
          { publicKey: 'd2', name: 'Laptop', enrolledAt: 3, userId: null },
          { publicKey: 'd4', name: 'Guest', enrolledAt: 4, userId: '9', taskId: 't1' },
          { publicKey: 'd5', name: 'Teammate', enrolledAt: 5, userId: '8', teamId: 'team-1' },
          { publicKey: 'd3', name: 'Broken' },
          'nope',
        ],
        access: {
          owner: { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: 3 },
          members: [
            { user: { id: '7', login: 'kai', avatarUrl: 'https://a/7' }, addedAt: 5 },
            { user: { id: '8' }, addedAt: 6 },
            { user: { id: '9', login: 'lee' } },
            'nope',
          ],
        },
        link: { secret: 's2', invite: 'tok', createdAt: 2 },
        guests: [{ user: { id: '9', login: 'lee' }, addedAt: 7 }, 'nope'],
        handoffs: [
          { taskId: 't1', secret: 's3', invite: 'tok2', createdAt: 3 },
          { secret: 's4', invite: 'tok3', createdAt: 3 },
          'nope',
        ],
        requests: [
          {
            id: 'r1',
            publicKey: 'k1',
            deviceName: 'Bob iPhone',
            user: { id: '7', login: 'kai' },
            requestedAt: 9,
          },
          { id: 'r2', publicKey: 'k2', deviceName: 'Mac', user: { id: '1' }, requestedAt: 9 },
          { id: 'r3', publicKey: 'k3', deviceName: 'Mac', user: { id: '1', login: 'mona' } },
          {
            id: 'r4',
            publicKey: 4,
            deviceName: 'Mac',
            user: { id: '1', login: 'mona' },
            requestedAt: 9,
          },
          'nope',
        ],
        grants: [{ userId: '7', teamId: 't1', secret: 'g1' }, { userId: '8', teamId: 't1' }, 'nope'],
        extras: [
          { teamId: 't1', userId: '7', scopes: ['message', 'teleport'] },
          { teamId: 't1', scopes: ['message'] },
          { teamId: 't1', userId: '8', scopes: 'message' },
          'nope',
        ],
        relayDevices: [
          {
            instanceId: 'kai-mac',
            teamId: 't1',
            machineKey: 'mk',
            publicKey: 'pk',
            privateKey: 'sk',
            enrolledAt: 4,
          },
          { instanceId: 'lee-mac', teamId: 't1', machineKey: 'mk', publicKey: 'pk', privateKey: 'sk' },
          {
            instanceId: 'gus-mac',
            teamId: 't1',
            machineKey: 3,
            publicKey: 'pk',
            privateKey: 'sk',
            enrolledAt: 4,
          },
          'nope',
        ],
      })
    );
    expect(await readRemoteFile(path)).toEqual({
      version: 1,
      teams: [],
      teamKeys: [],
      grants: [{ userId: '7', teamId: 't1', secret: 'g1' }],
      extras: [{ teamId: 't1', userId: '7', scopes: ['message'] }],
      relayDevices: [
        {
          instanceId: 'kai-mac',
          teamId: 't1',
          machineKey: 'mk',
          publicKey: 'pk',
          privateKey: 'sk',
          enrolledAt: 4,
        },
      ],
      machine: { publicKey: 'p', privateKey: 'k' },
      signing: null,
      credentials: CREDENTIALS,
      owner: 'mona',
      enabled: true,
      devices: [
        { publicKey: 'd1', name: 'Phone', enrolledAt: 1, lastSeenAt: 2, userId: '7' },
        { publicKey: 'd4', name: 'Guest', enrolledAt: 4, lastSeenAt: null, userId: '9', taskId: 't1' },
        { publicKey: 'd5', name: 'Teammate', enrolledAt: 5, lastSeenAt: null, userId: '8', teamId: 'team-1' },
      ],
      access: {
        owner: { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null },
        members: [{ user: { id: '7', login: 'kai', name: null, avatarUrl: 'https://a/7' }, addedAt: 5 }],
      },
      link: { secret: 's2', invite: 'tok', createdAt: 2 },
      requests: [
        {
          id: 'r1',
          publicKey: 'k1',
          deviceName: 'Bob iPhone',
          user: { id: '7', login: 'kai', name: null, avatarUrl: null },
          requestedAt: 9,
        },
      ],
      guests: [{ user: { id: '9', login: 'lee', name: null, avatarUrl: null }, addedAt: 7 }],
      handoffs: [{ taskId: 't1', secret: 's3', invite: 'tok2', createdAt: 3 }],
    });
  });

  test('reads a file missing part of its credentials as not paired, and never enabled', async () => {
    const path = createPath();
    const logs = captureLogs();
    writeFileSync(
      path,
      JSON.stringify({
        credentials: { ...CREDENTIALS, connectKey: '' },
        enabled: true,
        machine: { publicKey: 1 },
      })
    );
    const file = await readRemoteFile(path);
    expect(file.credentials).toBeNull();
    expect(file.enabled).toBe(false);
    expect(file.machine).toBeNull();
    expect(
      logs.fieldsOf('[Remote] remote.json is missing part of its credentials; pair this machine again')
    ).toHaveLength(1);
    writeFileSync(
      path,
      JSON.stringify({
        credentials: 'x',
        devices: 'x',
        access: { owner: 'mona' },
        link: { secret: 's', invite: 'i' },
        requests: 'x',
      })
    );
    expect((await readRemoteFile(path)).credentials).toBeNull();
    expect((await readRemoteFile(path)).link).toBeNull();
    expect((await readRemoteFile(path)).access).toBeNull();
    writeFileSync(path, JSON.stringify({ access: { owner: { id: '1', login: 'mona' }, members: 'x' } }));
    expect((await readRemoteFile(path)).access).toEqual({
      owner: { id: '1', login: 'mona', name: null, avatarUrl: null },
      members: [],
    });
    logs.restore();
  });
});

describe('the remote store', () => {
  test('writes with mode 600 and keeps devices by public key', async () => {
    const store = await openTestStore(createPath());
    await store.upsertDevice({
      publicKey: 'd1',
      name: 'Phone',
      enrolledAt: 1,
      lastSeenAt: null,
      userId: '1',
    });
    await store.upsertDevice({
      publicKey: 'd1',
      name: 'Phone again',
      enrolledAt: 2,
      lastSeenAt: null,
      userId: '1',
    });
    await store.recordDeviceSeen('d1', 5);
    await store.recordDeviceSeen('unknown', 5);
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    expect(store.file.devices).toEqual([
      { publicKey: 'd1', name: 'Phone again', enrolledAt: 2, lastSeenAt: 5, userId: '1' },
    ]);
    expect(store.selectDevice('d1')?.name).toBe('Phone again');
    expect(await store.removeDevice('d1')).toBe(true);
    expect(await store.removeDevice('d1')).toBe(false);
    expect((await openTestStore(store.path)).file.devices).toEqual([]);
  });

  test('forgets only the devices of accounts that lost access', async () => {
    const store = await openTestStore(createPath());
    const device = { name: 'Phone', enrolledAt: 1, lastSeenAt: null };
    await store.upsertDevice({ ...device, publicKey: 'mine', userId: '1' });
    await store.upsertDevice({ ...device, publicKey: 'kai', userId: '7' });
    await store.upsertDevice({ ...device, publicKey: 'guest', userId: '9', taskId: 't1' });
    await store.upsertDevice({ ...device, publicKey: 'teammate', userId: '8', teamId: 'team-1' });
    expect(await store.removeDevicesOutside(new Set(['1', '7']), new Set(['9']))).toEqual([]);
    expect(await store.removeDevicesOutside(new Set(['1', '9']), new Set(['1']))).toEqual(['kai', 'guest']);
    expect(store.file.devices.map((entry) => entry.publicKey)).toEqual(['mine', 'teammate']);
    expect(await store.removeDevicesWhere((entry) => entry.teamId === 'team-1')).toEqual(['teammate']);
    expect(await store.removeDevicesWhere((entry) => entry.teamId === 'team-1')).toEqual([]);
  });

  test('keeps one grant per teammate and team, and drops the ones asked for', async () => {
    const store = await openTestStore(createPath());
    await store.writeGrant({ userId: '7', teamId: 't1', secret: 'first' });
    await store.writeGrant({ userId: '8', teamId: 't1', secret: 'other' });
    await store.writeGrant({ userId: '7', teamId: 't2', secret: 'again' });
    await store.writeGrant({ userId: '7', teamId: 't1', secret: 'renewed' });
    expect(store.selectGrant('7', 't1')).toEqual({ userId: '7', teamId: 't1', secret: 'renewed' });
    expect(store.listGrants('7').map((grant) => grant.teamId)).toEqual(['t2', 't1']);
    await store.removeGrantsWhere((grant) => grant.userId === 'nobody');
    expect(store.file.grants).toHaveLength(3);
    await store.removeGrantsWhere((grant) => grant.userId === '7');
    expect(store.file.grants.map((grant) => grant.userId)).toEqual(['8']);
    expect(store.selectGrant('7', 't2')).toBeNull();
  });

  test('keeps one set of extra scopes per teammate and team, and drops an empty one', async () => {
    const store = await openTestStore(createPath());
    await store.writeExtra({ teamId: 't1', userId: '7', scopes: ['message'] });
    await store.writeExtra({ teamId: 't1', userId: '8', scopes: ['share'] });
    await store.writeExtra({ teamId: 't1', userId: '7', scopes: ['message', 'services'] });
    expect(store.selectExtra('7', 't1')?.scopes).toEqual(['message', 'services']);
    expect(store.selectExtra('7', 't2')).toBeNull();
    await store.writeExtra({ teamId: 't1', userId: '8', scopes: [] });
    expect(store.file.extras.map((extra) => extra.userId)).toEqual(['7']);
    await store.removeExtrasWhere((extra) => extra.userId === 'nobody');
    await store.removeExtrasWhere((extra) => extra.userId === '7');
    expect(store.file.extras).toEqual([]);
  });

  test('keeps one relay device per teammate machine, and drops the ones asked for', async () => {
    const store = await openTestStore(createPath());
    const relay = { teamId: 't1', machineKey: 'mk', publicKey: 'pk', privateKey: 'sk', enrolledAt: 1 };
    await store.writeRelayDevice({ ...relay, instanceId: 'kai-mac' });
    await store.writeRelayDevice({ ...relay, instanceId: 'lee-mac' });
    await store.writeRelayDevice({ ...relay, instanceId: 'kai-mac', enrolledAt: 2 });
    expect(store.selectRelayDevice('kai-mac')?.enrolledAt).toBe(2);
    expect(store.selectRelayDevice('gus-mac')).toBeNull();
    expect(await store.removeRelayDevicesWhere((device) => device.instanceId === 'nobody')).toEqual([]);
    expect(await store.removeRelayDevicesWhere((device) => device.instanceId === 'kai-mac')).toEqual([
      'kai-mac',
    ]);
    expect(store.file.relayDevices.map((device) => device.instanceId)).toEqual(['lee-mac']);
  });

  test('creates the machine key once and reads it back after a restart', async () => {
    const path = createPath();
    const store = await openTestStore(path);
    const first = await store.resolveMachineKey();
    expect(await store.resolveMachineKey()).toEqual(first);
    const again = await (await openTestStore(path)).resolveMachineKey();
    expect(again.publicKey).toBe(first.publicKey);
    expect(readFileSync(path, 'utf8')).toContain(first.publicKey);
  });

  test('makes one machine key when two callers ask for it at once', async () => {
    const store = await openTestStore(createPath());
    const [first, second] = await Promise.all([store.resolveMachineKey(), store.resolveMachineKey()]);
    expect(second.publicKey).toBe(first.publicKey);
    expect(store.file.machine?.publicKey).toBe(first.publicKey);
  });

  test('makes a new machine key when the stored one cannot be read', async () => {
    const path = createPath();
    writeFileSync(path, JSON.stringify({ machine: { publicKey: 'p', privateKey: '{' } }));
    const store = await openTestStore(path);
    const key = await store.resolveMachineKey();
    expect(key.publicKey).not.toBe('p');
  });

  test('keeps a signing key apart from the machine key, made once and read back after a restart', async () => {
    const path = createPath();
    const store = await openTestStore(path);
    const first = await store.resolveSigningKey();
    expect(await store.resolveSigningKey()).toEqual(first);
    expect(first.publicKey).not.toBe((await store.resolveMachineKey()).publicKey);
    const again = await (await openTestStore(path)).resolveSigningKey();
    expect(again.publicKey).toBe(first.publicKey);
    expect(again.privateKey.algorithm.name).toBe('ECDSA');
  });

  test('makes a new signing key when the stored one cannot be read', async () => {
    const path = createPath();
    writeFileSync(path, JSON.stringify({ signing: { publicKey: 'p', privateKey: '{' } }));
    expect((await (await openTestStore(path)).resolveSigningKey()).publicKey).not.toBe('p');
  });
});

describe('the owner’s profile', () => {
  const mona = { id: '1', login: 'Mona', name: 'Mona Lisa', avatarUrl: 'https://avatars.example/mona' };

  test('is the name and avatar of the access owner whose login is the machine’s owner, in any case', async () => {
    const file = { ...(await readRemoteFile(join(createTempDir(), 'none.json'))), owner: 'mona' };
    expect(resolveOwnerProfile({ ...file, access: { owner: mona, members: [] } })).toEqual({
      name: 'Mona Lisa',
      avatarUrl: 'https://avatars.example/mona',
    });
  });

  test('is unknown without access, without an owner, or when the access owner is someone else', async () => {
    const file = await readRemoteFile(join(createTempDir(), 'none.json'));
    const access = { owner: mona, members: [] };
    expect(resolveOwnerProfile({ ...file, owner: 'mona' })).toBeNull();
    expect(resolveOwnerProfile({ ...file, access })).toBeNull();
    expect(resolveOwnerProfile({ ...file, owner: 'kai', access })).toBeNull();
  });
});

describe('readTeams', () => {
  test('keeps each team machine it can read and drops the rest', () => {
    const owner = { id: '1', login: 'mona' };
    const teams = readTeams([
      {
        id: 'team-1',
        name: 'Platform',
        role: 'owner',
        owner,
        createdAt: 1,
        machines: [
          { id: 'm1', name: 'Studio', userId: '1', online: true, lastSeenAt: 5, signingKey: 'sk' },
          { id: 'm2', name: 'Laptop', userId: '7', signingKey: 4 },
          { id: 'm3', name: 4, userId: '7' },
          'nope',
        ],
      },
      { id: 'team-2', name: 'Design', owner, createdAt: 2, machines: 'none' },
      { id: 'team-3', name: 'Broken', owner },
    ]);
    expect(teams?.map((team) => [team.id, team.role, team.machines])).toEqual([
      [
        'team-1',
        'owner',
        [
          { id: 'm1', name: 'Studio', userId: '1', online: true, lastSeenAt: 5, signingKey: 'sk' },
          { id: 'm2', name: 'Laptop', userId: '7', online: false, lastSeenAt: null },
        ],
      ],
      ['team-2', 'member', []],
    ]);
    expect(readTeams('none')).toBeNull();
  });

  test('reads what teammates may do and who is set apart, dropping what it cannot read', () => {
    const owner = { id: '1', login: 'mona' };
    const [team, bare] =
      readTeams([
        {
          id: 'team-1',
          name: 'Platform',
          owner,
          createdAt: 1,
          scopes: ['message', 'share', 'everything'],
          overrides: [
            { userId: '2', scopes: ['services', 7] },
            { userId: '3' },
            { scopes: ['fork'] },
            'nope',
          ],
        },
        { id: 'team-2', name: 'Design', owner, createdAt: 2, scopes: 'all', overrides: {} },
      ]) ?? [];
    expect(team?.scopes).toEqual(['message', 'share']);
    expect(team?.overrides).toEqual([{ userId: '2', scopes: ['services'] }]);
    expect(bare?.scopes).toEqual(DEFAULT_TEAM_SCOPES);
    expect(bare?.overrides).toEqual([]);
  });
});

describe('the team keys', () => {
  const owner = { id: '1', login: 'mona', name: null, avatarUrl: null };
  const team = {
    id: 'team-1',
    name: 'Platform',
    owner,
    role: 'owner' as const,
    members: [],
    requests: [],
    machines: [],
    scopes: DEFAULT_TEAM_SCOPES,
    overrides: [],
    createdAt: 1,
  };
  const key = 'A'.repeat(43);

  test('keeps a key per team, renames it with its team, and lists asked teams as requested', async () => {
    const store = await openTestStore(createPath());
    await store.upsertTeamKey({ teamId: 'team-1', name: 'Old', key, invite: 'join', addedAt: 1 });
    await store.upsertTeamKey({ teamId: 'team-2', name: 'Asked', key, invite: null, addedAt: 2 });
    expect(await store.recordTeams([team])).toBe(true);
    expect(await store.recordTeams([team])).toBe(false);
    expect(store.selectTeam('team-1')?.name).toBe('Platform');
    expect(store.selectTeam('team-9')).toBeNull();
    expect(store.selectTeamKey('team-1')?.name).toBe('Platform');
    expect((await openTestStore(store.path)).file.teamKeys.map((stored) => stored.teamId)).toEqual([
      'team-1',
      'team-2',
    ]);
    expect(listTeamEntries(store.file).map((entry) => [entry.id, entry.status, entry.invite])).toEqual([
      ['team-1', 'member', true],
      ['team-2', 'requested', false],
    ]);
    await store.writeExtra({ teamId: 'team-1', userId: '7', scopes: ['message'] });
    expect(listTeamEntries(store.file).map((entry) => entry.extras)).toEqual([
      [{ userId: '7', scopes: ['message'] }],
      [],
    ]);
    await store.removeTeam('team-1');
    expect(store.selectTeam('team-1')).toBeNull();
    expect(store.selectTeamKey('team-1')).toBeNull();
    expect(await store.recordTeams([team])).toBe(true);
    expect(await store.recordTeams([])).toBe(true);
    expect(store.file.teamKeys.map((stored) => stored.teamId)).toEqual(['team-2']);
    expect((await store.update((file) => ({ ...file, owner: 'mona' }))).owner).toBe('mona');
  });
});
