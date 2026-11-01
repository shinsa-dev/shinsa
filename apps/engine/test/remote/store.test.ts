import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../../src/log/index.ts';
import { RemoteStore, readRemoteFile, readTeams } from '../../src/remote/store.ts';
import { createTempDir } from '../helpers/index.ts';

const CREDENTIALS = {
  instanceId: 'k3x9',
  machineToken: 'machine',
  tunnelToken: 'tunnel',
  tunnelHost: 't-k3x9.shinsa.dev',
  connectKey: 'AAAA',
};

function createPath() {
  return join(createTempDir(), 'remote.json');
}

describe('remote.json', () => {
  test('reads as not paired when it is missing, broken or not an object', () => {
    const path = createPath();
    expect(readRemoteFile(path).credentials).toBeNull();
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    writeFileSync(path, '{');
    expect(readRemoteFile(path).enabled).toBe(false);
    writeFileSync(path, '[]');
    expect(readRemoteFile(path).devices).toEqual([]);
    warn.mockRestore();
  });

  test('reads a paired file and drops what it cannot use', () => {
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
          { publicKey: 'd2', name: 'Laptop', enrolledAt: 3 },
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
      })
    );
    expect(readRemoteFile(path)).toEqual({
      version: 1,
      teams: [],
      teamKeys: [],
      grants: [],
      machine: { publicKey: 'p', privateKey: 'k' },
      credentials: CREDENTIALS,
      owner: 'mona',
      enabled: true,
      devices: [
        { publicKey: 'd1', name: 'Phone', enrolledAt: 1, lastSeenAt: 2, userId: '7' },
        {
          publicKey: 'd2',
          name: 'Laptop',
          enrolledAt: 3,
          lastSeenAt: null,
          userId: null,
        },
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
    });
  });

  test('reads a file missing part of its credentials as not paired, and never enabled', () => {
    const path = createPath();
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    writeFileSync(
      path,
      JSON.stringify({
        credentials: { ...CREDENTIALS, tunnelToken: '' },
        enabled: true,
        machine: { publicKey: 1 },
      })
    );
    const file = readRemoteFile(path);
    expect(file.credentials).toBeNull();
    expect(file.enabled).toBe(false);
    expect(file.machine).toBeNull();
    expect(warn).toHaveBeenCalled();
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
    expect(readRemoteFile(path).credentials).toBeNull();
    expect(readRemoteFile(path).link).toBeNull();
    expect(readRemoteFile(path).access).toBeNull();
    writeFileSync(path, JSON.stringify({ access: { owner: { id: '1', login: 'mona' }, members: 'x' } }));
    expect(readRemoteFile(path).access).toEqual({
      owner: { id: '1', login: 'mona', name: null, avatarUrl: null },
      members: [],
    });
    warn.mockRestore();
  });
});

describe('the remote store', () => {
  test('writes with mode 600 and keeps devices by public key', () => {
    const store = new RemoteStore(createPath());
    store.upsertDevice({
      publicKey: 'd1',
      name: 'Phone',
      enrolledAt: 1,
      lastSeenAt: null,
      userId: null,
    });
    store.upsertDevice({
      publicKey: 'd1',
      name: 'Phone again',
      enrolledAt: 2,
      lastSeenAt: null,
      userId: null,
    });
    store.recordDeviceSeen('d1', 5);
    store.recordDeviceSeen('unknown', 5);
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    expect(store.file.devices).toEqual([
      { publicKey: 'd1', name: 'Phone again', enrolledAt: 2, lastSeenAt: 5, userId: null },
    ]);
    expect(store.selectDevice('d1')?.name).toBe('Phone again');
    expect(store.removeDevice('d1')).toBe(true);
    expect(store.removeDevice('d1')).toBe(false);
    expect(new RemoteStore(store.path).file.devices).toEqual([]);
  });

  test('forgets only the devices of accounts that lost access, keeping devices from before accounts were recorded', () => {
    const store = new RemoteStore(createPath());
    const device = { name: 'Phone', enrolledAt: 1, lastSeenAt: null };
    store.upsertDevice({ ...device, publicKey: 'mine', userId: '1' });
    store.upsertDevice({ ...device, publicKey: 'kai', userId: '7' });
    store.upsertDevice({ ...device, publicKey: 'old', userId: null });
    expect(store.removeDevicesOutside(new Set(['1', '7']))).toEqual([]);
    expect(store.removeDevicesOutside(new Set(['1']))).toEqual(['kai']);
    expect(store.file.devices.map((entry) => entry.publicKey)).toEqual(['mine', 'old']);
  });

  test('creates the machine key once and reads it back after a restart', async () => {
    const path = createPath();
    const store = new RemoteStore(path);
    const first = await store.resolveMachineKey();
    expect(await store.resolveMachineKey()).toEqual(first);
    const again = await new RemoteStore(path).resolveMachineKey();
    expect(again.publicKey).toBe(first.publicKey);
    expect(readFileSync(path, 'utf8')).toContain(first.publicKey);
  });

  test('makes a new machine key when the stored one cannot be read', async () => {
    const path = createPath();
    writeFileSync(path, JSON.stringify({ machine: { publicKey: 'p', privateKey: '{' } }));
    const store = new RemoteStore(path);
    const key = await store.resolveMachineKey();
    expect(key.publicKey).not.toBe('p');
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
          { id: 'm1', name: 'Studio', userId: '1', online: true, lastSeenAt: 5 },
          { id: 'm2', name: 'Laptop', userId: '7' },
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
          { id: 'm1', name: 'Studio', userId: '1', online: true, lastSeenAt: 5 },
          { id: 'm2', name: 'Laptop', userId: '7', online: false, lastSeenAt: null },
        ],
      ],
      ['team-2', 'member', []],
    ]);
    expect(readTeams('none')).toBeNull();
  });
});
