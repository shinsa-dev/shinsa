import { REMOTE_KEY_ALGORITHM } from '@shinsa/core';
import { Effect, Schema } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';
import {
  DEVICE_PREFIX,
  DEVICE_STORE_FAILED,
  DeviceStoreFailed,
  EnrolledDevice,
  type KeyValueStore,
} from './schema.ts';

export function createDeviceKeys() {
  return crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, false, ['deriveBits']) as Promise<CryptoKeyPair>;
}

export function createDeviceStore(store: KeyValueStore) {
  const isEnrolledDevice = Schema.is(EnrolledDevice);
  function enter<A>(step: () => Promise<A>) {
    return Effect.tryPromise({
      try: step,
      catch: () => new DeviceStoreFailed({ message: DEVICE_STORE_FAILED }),
    });
  }

  const selectDevice = Effect.fn('Devices.selectDevice')(function* (instanceId: string) {
    const value = yield* enter(() => store.read(`${DEVICE_PREFIX}${instanceId}`));
    return isEnrolledDevice(value) && value.instanceId === instanceId ? value : null;
  });

  const listWaitingDevices = Effect.fn('Devices.listWaitingDevices')(function* () {
    const keys = yield* enter(() => store.listKeys());
    const ids = keys
      .filter((key) => key.startsWith(DEVICE_PREFIX))
      .map((key) => key.slice(DEVICE_PREFIX.length));
    const devices = yield* Effect.forEach(ids, selectDevice, { concurrency: 'unbounded' });
    return devices.filter((device): device is EnrolledDevice => device?.waiting !== undefined);
  });

  return {
    selectDevice: (instanceId: string) => runApp(selectDevice(instanceId)),
    listWaitingDevices: () => runApp(listWaitingDevices()),
    writeDevice: (device: EnrolledDevice) =>
      runApp(enter(() => store.write(`${DEVICE_PREFIX}${device.instanceId}`, device))),
    removeDevice: (instanceId: string) => runApp(enter(() => store.remove(`${DEVICE_PREFIX}${instanceId}`))),
  };
}

export type DeviceStore = ReturnType<typeof createDeviceStore>;
