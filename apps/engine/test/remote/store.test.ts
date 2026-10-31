import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../../src/log/index.ts';
import { RemoteStore, readRemoteFile } from '../../src/remote/store.ts';
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
          { publicKey: 'd1', name: 'Phone', enrolledAt: 1, lastSeenAt: 2 },
          { publicKey: 'd2', name: 'Laptop', enrolledAt: 3 },
          { publicKey: 'd3', name: 'Broken' },
          'nope',
        ],
      })
    );
    expect(readRemoteFile(path)).toEqual({
      version: 1,
      machine: { publicKey: 'p', privateKey: 'k' },
      credentials: CREDENTIALS,
      owner: 'mona',
      enabled: true,
      devices: [
        { publicKey: 'd1', name: 'Phone', enrolledAt: 1, lastSeenAt: 2 },
        { publicKey: 'd2', name: 'Laptop', enrolledAt: 3, lastSeenAt: null },
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
    writeFileSync(path, JSON.stringify({ credentials: 'x', devices: 'x' }));
    expect(readRemoteFile(path).credentials).toBeNull();
    warn.mockRestore();
  });
});

describe('the remote store', () => {
  test('writes with mode 600 and keeps devices by public key', () => {
    const store = new RemoteStore(createPath());
    store.upsertDevice({ publicKey: 'd1', name: 'Phone', enrolledAt: 1, lastSeenAt: null });
    store.upsertDevice({ publicKey: 'd1', name: 'Phone again', enrolledAt: 2, lastSeenAt: null });
    store.recordDeviceSeen('d1', 5);
    store.recordDeviceSeen('unknown', 5);
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    expect(store.file.devices).toEqual([
      { publicKey: 'd1', name: 'Phone again', enrolledAt: 2, lastSeenAt: 5 },
    ]);
    expect(store.selectDevice('d1')?.name).toBe('Phone again');
    expect(store.removeDevice('d1')).toBe(true);
    expect(store.removeDevice('d1')).toBe(false);
    expect(new RemoteStore(store.path).file.devices).toEqual([]);
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
