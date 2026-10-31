import { describe, expect, it } from 'bun:test';
import { serializeBase64Url, serializePublicKey } from '@shinsa/core';
import { openRemoteChannel } from '@/lib/remote/channel.ts';
import type { EnrolledDevice } from '@/lib/remote/devices.ts';
import { type EnrollOptions, requestDeviceAccess } from '@/lib/remote/enroll.ts';
import { createKeyPair, FakeMac } from './fake-mac.ts';

const SECRET = serializeBase64Url(new Uint8Array(32).fill(9));

const USER = { id: '2', login: 'kai', name: null, avatarUrl: null };

function createOptions(mac: FakeMac, overrides: Partial<EnrollOptions> = {}) {
  const written: EnrolledDevice[] = [];
  const steps: string[] = [];
  const options: EnrollOptions = {
    dashboard: {
      requestConnect: () => {
        steps.push('connect');
        return Promise.resolve({ url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 });
      },
      acceptInvite: (token) => {
        steps.push(`accept ${token}`);
        return Promise.resolve({
          instanceId: 'k3x9',
          name: 'Studio',
          owner: { id: '1', login: 'mona', name: null, avatarUrl: null },
          user: USER,
          connect: { url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 },
        });
      },
    },
    devices: {
      writeDevice: (entry) => {
        written.push(entry);
        return Promise.resolve();
      },
    },
    name: 'Kai iPhone',
    onPending: () => steps.push('pending'),
    now: () => 42,
    retryMs: 1,
    createKeys: createKeyPair,
    openChannel: (channel) => openRemoteChannel({ ...channel, openSocket: mac.openSocket }),
    ...overrides,
  };
  return { options, written, steps };
}

function createInput(mac: FakeMac, invite: string | null = null, secret = SECRET) {
  return { instanceId: 'k3x9', machineKey: mac.machineKey, secret, invite, onMachine: invite === null };
}

describe('asking a machine for access from this browser', () => {
  it('sends the device name, waits until it is accepted and remembers the pinned machine key', async () => {
    const mac = await FakeMac.create({ enrollSecret: SECRET });
    const { options, written, steps } = createOptions(mac);
    const device = await requestDeviceAccess(createInput(mac), options);
    expect(steps).toEqual(['connect', 'pending']);
    expect(mac.names).toEqual(['Kai iPhone']);
    expect(written).toEqual([device]);
    expect(device).toMatchObject({
      instanceId: 'k3x9',
      machineKey: mac.machineKey,
      enrolledAt: 42,
      onMachine: true,
    });
    expect(mac.enrolled.has(await serializePublicKey(device.keys.publicKey))).toBe(true);
    expect(mac.last.closedWith?.code).toBe(1000);
  });

  it('opens an invite through Shinsa Cloud, which hands over the connect token', async () => {
    const mac = await FakeMac.create({ enrollSecret: SECRET });
    const { options, steps } = createOptions(mac);
    await requestDeviceAccess(createInput(mac, 'tok'), options);
    expect(steps).toEqual(['accept tok', 'pending']);
  });

  it('asks again with the same key when the connection drops while it waits', async () => {
    const mac = await FakeMac.create({ enrollSecret: SECRET, pendingDrops: 1 });
    const { options, steps } = createOptions(mac);
    const device = await requestDeviceAccess(createInput(mac), options);
    expect(steps).toEqual(['connect', 'pending', 'connect', 'pending']);
    expect(mac.enrolled.has(await serializePublicKey(device.keys.publicKey))).toBe(true);
  });

  it('remembers nothing when the machine refuses, and never retries a failure before it waited', async () => {
    const mac = await FakeMac.create({ enrollSecret: SECRET });
    const { options, written, steps } = createOptions(mac);
    const refused = requestDeviceAccess(
      createInput(mac, null, serializeBase64Url(new Uint8Array(32))),
      options
    );
    await expect(refused).rejects.toThrow('not enrolled');
    expect(written).toEqual([]);
    const failing = createOptions(mac, {
      dashboard: {
        acceptInvite: () => Promise.reject(new Error('This invite link was turned off.')),
        requestConnect: () => Promise.reject(new Error('Never asked.')),
      },
    });
    await expect(requestDeviceAccess(createInput(mac, 'tok'), failing.options)).rejects.toThrow('turned off');
    expect(steps).toEqual(['connect']);
  });
});
