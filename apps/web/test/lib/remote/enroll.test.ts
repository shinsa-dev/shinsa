import { describe, expect, it } from 'bun:test';
import { serializeBase64Url, serializePublicKey } from '@shinsa/core';
import { openRemoteChannel } from '@/lib/remote/channel.ts';
import type { EnrolledDevice } from '@/lib/remote/devices.ts';
import { enrollDevice } from '@/lib/remote/enroll.ts';
import { createKeyPair, FakeMac } from './fake-mac.ts';

const SECRET = serializeBase64Url(new Uint8Array(32).fill(9));

describe('enrolling this browser on a machine', () => {
  it('makes a device key, proves the one-time secret and remembers the pinned machine key', async () => {
    const mac = await FakeMac.create({ enrollSecret: SECRET });
    const written: EnrolledDevice[] = [];
    const device = await enrollDevice(
      { instanceId: 'k3x9', machineKey: mac.machineKey, secret: SECRET, invite: null, onMachine: true },
      {
        dashboard: {
          requestConnect: () => Promise.resolve({ url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 }),
          acceptInvite: () => Promise.reject(new Error('An own link accepts no invite.')),
        },
        devices: {
          writeDevice: (entry) => {
            written.push(entry);
            return Promise.resolve();
          },
        },
        now: () => 42,
        createKeys: createKeyPair,
        openChannel: (options) => openRemoteChannel({ ...options, openSocket: mac.openSocket }),
      }
    );
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

  it('accepts the invite before it opens the channel, and stops when the invite is refused', async () => {
    const mac = await FakeMac.create({ enrollSecret: SECRET });
    const steps: string[] = [];
    const devices = { writeDevice: () => Promise.resolve() };
    const input = {
      instanceId: 'k3x9',
      machineKey: mac.machineKey,
      secret: SECRET,
      invite: 'tok',
      onMachine: false,
    };
    await enrollDevice(input, {
      dashboard: {
        acceptInvite: (token) => {
          steps.push(`accept ${token}`);
          return Promise.resolve({
            instanceId: 'k3x9',
            name: 'Studio',
            owner: { id: '1', login: 'mona', name: null, avatarUrl: null },
          });
        },
        requestConnect: () => {
          steps.push('connect');
          return Promise.resolve({ url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 });
        },
      },
      devices,
      createKeys: createKeyPair,
      openChannel: (options) => openRemoteChannel({ ...options, openSocket: mac.openSocket }),
    });
    expect(steps).toEqual(['accept tok', 'connect']);
    const refused = enrollDevice(input, {
      dashboard: {
        acceptInvite: () => Promise.reject(new Error('This invite expired or was already used.')),
        requestConnect: () => Promise.reject(new Error('Never asked.')),
      },
      devices,
      createKeys: createKeyPair,
    });
    await expect(refused).rejects.toThrow('This invite expired');
  });

  it('remembers nothing when the machine refuses the secret', async () => {
    const mac = await FakeMac.create({ enrollSecret: SECRET });
    const written: EnrolledDevice[] = [];
    const enrolling = enrollDevice(
      {
        instanceId: 'k3x9',
        machineKey: mac.machineKey,
        secret: serializeBase64Url(new Uint8Array(32)),
        invite: null,
        onMachine: false,
      },
      {
        dashboard: {
          requestConnect: () => Promise.resolve({ url: 'wss://x', expiresAt: 0 }),
          acceptInvite: () => Promise.reject(new Error('An own link accepts no invite.')),
        },
        devices: {
          writeDevice: (entry) => {
            written.push(entry);
            return Promise.resolve();
          },
        },
        openChannel: (options) => openRemoteChannel({ ...options, openSocket: mac.openSocket }),
      }
    );
    await expect(enrolling).rejects.toThrow('not enrolled');
    expect(written).toEqual([]);
  });
});
