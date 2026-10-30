import { describe, expect, it } from 'bun:test';
import { serializeBase64Url, serializePublicKey } from '@shinsa/core';
import { openRemoteChannel } from '@/lib/remote/channel.ts';
import type { EnrolledDevice } from '@/lib/remote/devices.ts';
import { enrollDevice } from '@/lib/remote/enroll.ts';
import { createKeyPair, FakeMac } from './fake-mac.ts';

const SECRET = serializeBase64Url(new Uint8Array(32).fill(9));

describe('enrolling this browser on a Mac', () => {
  it('makes a device key, proves the one-time secret and remembers the pinned Mac key', async () => {
    const mac = await FakeMac.create({ enrollSecret: SECRET });
    const written: EnrolledDevice[] = [];
    const device = await enrollDevice(
      { instanceId: 'k3x9', machineKey: mac.machineKey, secret: SECRET },
      {
        dashboard: {
          requestConnect: () => Promise.resolve({ url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 }),
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
    expect(device).toMatchObject({ instanceId: 'k3x9', machineKey: mac.machineKey, enrolledAt: 42 });
    expect(mac.enrolled.has(await serializePublicKey(device.keys.publicKey))).toBe(true);
    expect(mac.last.closedWith?.code).toBe(1000);
  });

  it('remembers nothing when the Mac refuses the secret', async () => {
    const mac = await FakeMac.create({ enrollSecret: SECRET });
    const written: EnrolledDevice[] = [];
    const enrolling = enrollDevice(
      { instanceId: 'k3x9', machineKey: mac.machineKey, secret: serializeBase64Url(new Uint8Array(32)) },
      {
        dashboard: { requestConnect: () => Promise.resolve({ url: 'wss://x', expiresAt: 0 }) },
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
