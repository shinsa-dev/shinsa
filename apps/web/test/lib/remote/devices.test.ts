import { describe, expect, it } from 'bun:test';
import { createDeviceKeys, createDeviceStore, type KeyValueStore } from '@/lib/remote/devices.ts';
import { createIndexedStore } from '@/lib/remote/indexed-store.ts';
import { createFakeIndexedDb } from './fake-indexed-db.ts';

function createMemoryStore(): KeyValueStore & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    read: (key) => Promise.resolve(values.get(key)),
    write: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    listKeys: () => Promise.resolve([...values.keys()]),
  };
}

describe('the devices this browser enrolled', () => {
  it('keeps a device key that cannot be exported, per machine', async () => {
    const keys = await createDeviceKeys();
    expect(keys.privateKey.extractable).toBe(false);
    const memory = createMemoryStore();
    const devices = createDeviceStore(memory);
    const device = { instanceId: 'k3x9', machineKey: 'mk', keys, enrolledAt: 1 };
    await devices.writeDevice(device);
    expect(await devices.selectDevice('k3x9')).toBe(device);
    expect(await devices.selectDevice('other')).toBeNull();
    await devices.removeDevice('k3x9');
    expect(await devices.selectDevice('k3x9')).toBeNull();
  });

  it('reads nothing from a broken or mislabelled entry', async () => {
    const keys = await createDeviceKeys();
    const memory = createMemoryStore();
    const devices = createDeviceStore(memory);
    memory.values.set('device:a', null);
    memory.values.set('device:b', { instanceId: 'b', machineKey: 'mk', enrolledAt: 1, keys: {} });
    memory.values.set('device:c', { instanceId: 'other', machineKey: 'mk', enrolledAt: 1, keys });
    memory.values.set('device:d', { instanceId: 'd', machineKey: 1, enrolledAt: 1, keys });
    for (const id of ['a', 'b', 'c', 'd']) expect(await devices.selectDevice(id)).toBeNull();
  });

  it('lists the devices still waiting for an answer, whatever else the store holds', async () => {
    const keys = await createDeviceKeys();
    const memory = createMemoryStore();
    const devices = createDeviceStore(memory);
    const waiting = {
      instanceId: 'w',
      machineKey: 'mk',
      keys,
      enrolledAt: 1,
      waiting: { machineName: 'Studio' },
    };
    await devices.writeDevice(waiting);
    await devices.writeDevice({ instanceId: 'a', machineKey: 'mk', keys, enrolledAt: 1 });
    memory.values.set('other', waiting);
    memory.values.set('device:broken', null);
    expect(await devices.listWaitingDevices()).toEqual([waiting]);
  });
});

describe('the IndexedDB store', () => {
  it('writes, reads and removes values, opening the database once', async () => {
    const fake = createFakeIndexedDb();
    const store = createIndexedStore(fake.factory);
    await store.write('device:k3x9', { a: 1 });
    expect(await store.read('device:k3x9')).toEqual({ a: 1 });
    expect(await store.listKeys()).toEqual(['device:k3x9']);
    await store.remove('device:k3x9');
    expect(await store.read('device:k3x9')).toBeUndefined();
    expect(fake.opened).toBe(1);
    expect(fake.stores).toEqual(['keys']);
  });

  it('fails a request IndexedDB refuses', async () => {
    const fake = createFakeIndexedDb({ fail: true });
    const store = createIndexedStore(fake.factory);
    await expect(store.read('x')).rejects.toThrow('IndexedDB refused the request.');
    const named = createFakeIndexedDb({ fail: true, error: new DOMException('Quota', 'QuotaExceededError') });
    await expect(createIndexedStore(named.factory).read('x')).rejects.toThrow('Quota');
  });
});
