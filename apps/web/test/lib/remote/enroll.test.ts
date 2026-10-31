import { describe, expect, it } from 'bun:test';
import { serializeBase64Url, serializePublicKey } from '@shinsa/core';
import {
  ChannelError,
  type ChannelOptions,
  openRemoteChannel,
  type RemoteChannel,
} from '@/lib/remote/channel.ts';
import type { EnrolledDevice } from '@/lib/remote/devices.ts';
import { type EnrollOptions, requestDeviceAccess, requestWaitingAnswer } from '@/lib/remote/enroll.ts';
import { createKeyPair, FakeMac } from './fake-mac.ts';

const SECRET = serializeBase64Url(new Uint8Array(32).fill(9));

const USER = { id: '2', login: 'kai', name: null, avatarUrl: null };

function createOptions(mac: FakeMac, overrides: Partial<EnrollOptions> = {}) {
  const written: EnrolledDevice[] = [];
  const steps: string[] = [];
  const options: EnrollOptions = {
    dashboard: {
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

function createInput(mac: FakeMac, secret = SECRET, onMachine = true) {
  return { instanceId: 'k3x9', machineKey: mac.machineKey, secret, invite: 'tok', onMachine };
}

describe('asking a machine for access from this browser', () => {
  it('sends the device name through the invite, keeps the key while it waits and remembers it once accepted', async () => {
    const mac = await FakeMac.create({ enrollSecret: SECRET });
    const { options, written, steps } = createOptions(mac);
    const device = await requestDeviceAccess(createInput(mac), options);
    expect(steps).toEqual(['accept tok', 'pending']);
    expect(mac.names).toEqual(['Kai iPhone']);
    expect(written).toEqual([{ ...device, waiting: { machineName: 'Studio' } }, device]);
    expect(device).toMatchObject({
      instanceId: 'k3x9',
      machineKey: mac.machineKey,
      enrolledAt: 42,
      onMachine: true,
    });
    expect(mac.enrolled.has(await serializePublicKey(device.keys.publicKey))).toBe(true);
    expect(mac.last.closedWith?.code).toBe(1000);
  });

  it('leaves a device added elsewhere off this machine', async () => {
    const mac = await FakeMac.create({ enrollSecret: SECRET });
    const { options } = createOptions(mac);
    const device = await requestDeviceAccess(createInput(mac, SECRET, false), options);
    expect(device.onMachine).toBeUndefined();
  });

  it('asks again with the same key when the connection drops while it waits', async () => {
    const mac = await FakeMac.create({ enrollSecret: SECRET, pendingDrops: 1 });
    const { options, steps } = createOptions(mac);
    const device = await requestDeviceAccess(createInput(mac), options);
    expect(steps).toEqual(['accept tok', 'pending', 'accept tok', 'pending']);
    expect(mac.enrolled.has(await serializePublicKey(device.keys.publicKey))).toBe(true);
  });

  it('remembers nothing when the machine refuses, and never retries a failure before it waited', async () => {
    const mac = await FakeMac.create({ enrollSecret: SECRET });
    const { options, written, steps } = createOptions(mac);
    const refused = requestDeviceAccess(createInput(mac, serializeBase64Url(new Uint8Array(32))), options);
    await expect(refused).rejects.toThrow('not enrolled');
    expect(written).toEqual([]);
    const failing = createOptions(mac, {
      dashboard: {
        acceptInvite: () => Promise.reject(new Error('This invite link was turned off.')),
      },
    });
    await expect(requestDeviceAccess(createInput(mac), failing.options)).rejects.toThrow('turned off');
    expect(steps).toEqual(['accept tok']);
  });
});

describe('a device that left while it waited for an answer', () => {
  async function createWaiting(open: (options: ChannelOptions) => Promise<RemoteChannel>) {
    const device: EnrolledDevice = {
      instanceId: 'k3x9',
      machineKey: 'mk',
      keys: await createKeyPair(),
      enrolledAt: 1,
      waiting: { machineName: 'Studio' },
    };
    const written: EnrolledDevice[] = [];
    const removed: string[] = [];
    const closed: string[] = [];
    const options = {
      dashboard: {
        requestConnect: () => Promise.resolve({ url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 }),
      },
      devices: {
        writeDevice: (entry: EnrolledDevice) => {
          written.push(entry);
          return Promise.resolve();
        },
        removeDevice: (id: string) => {
          removed.push(id);
          return Promise.resolve();
        },
      },
      openChannel: open,
      openSocket: (url: string) => ({ close: () => closed.push(url) }) as unknown as WebSocket,
    };
    return { device, options, written, removed, closed };
  }

  it('keeps the key once the request was accepted', async () => {
    const waiting = await createWaiting(() =>
      Promise.resolve({ close: () => undefined } as unknown as RemoteChannel)
    );
    expect(await requestWaitingAnswer(waiting.device, waiting.options)).toBe('accepted');
    const { waiting: _waiting, ...accepted } = waiting.device;
    expect(waiting.written).toEqual([accepted]);
  });

  it('goes on waiting, closing the socket at once, while the request is open', async () => {
    const waiting = await createWaiting((options) => {
      options.openSocket?.(options.url);
      options.onPending?.();
      return Promise.reject(new ChannelError('The connection to your machine closed.'));
    });
    expect(await requestWaitingAnswer(waiting.device, waiting.options)).toBe('waiting');
    expect(waiting.closed).toEqual(['wss://t-k3x9.shinsa.dev/remote']);
    expect(waiting.written).toEqual([]);
  });

  it('forgets the key once the request was declined, and waits when the machine cannot be reached', async () => {
    const declined = await createWaiting(() => Promise.reject(new ChannelError('Declined.', true)));
    expect(await requestWaitingAnswer(declined.device, declined.options)).toBe('declined');
    expect(declined.removed).toEqual(['k3x9']);
    const offline = await createWaiting(() =>
      Promise.reject(new ChannelError('Couldn’t reach your machine.'))
    );
    expect(await requestWaitingAnswer(offline.device, offline.options)).toBe('waiting');
    expect(offline.removed).toEqual([]);
  });
});
