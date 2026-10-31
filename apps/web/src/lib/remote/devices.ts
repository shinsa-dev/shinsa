import { REMOTE_KEY_ALGORITHM } from '@shinsa/core';

export interface KeyValueStore {
  read: (key: string) => Promise<unknown>;
  write: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
  listKeys: () => Promise<string[]>;
}

export interface EnrolledDevice {
  instanceId: string;
  machineKey: string;
  keys: CryptoKeyPair;
  enrolledAt: number;
  onMachine?: true;
  waiting?: { machineName: string };
}

const DEVICE_PREFIX = 'device:';

function isEnrolledDevice(value: unknown): value is EnrolledDevice {
  if (value === null || typeof value !== 'object') return false;
  const fields = value as Partial<EnrolledDevice>;
  return (
    typeof fields.instanceId === 'string' &&
    typeof fields.machineKey === 'string' &&
    typeof fields.enrolledAt === 'number' &&
    fields.keys?.privateKey instanceof CryptoKey &&
    fields.keys.publicKey instanceof CryptoKey
  );
}

export function createDeviceKeys() {
  return crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, false, ['deriveBits']) as Promise<CryptoKeyPair>;
}

export function createDeviceStore(store: KeyValueStore) {
  async function selectDevice(instanceId: string) {
    const value = await store.read(`${DEVICE_PREFIX}${instanceId}`);
    return isEnrolledDevice(value) && value.instanceId === instanceId ? value : null;
  }
  return {
    selectDevice,
    async listWaitingDevices() {
      const ids = (await store.listKeys())
        .filter((key) => key.startsWith(DEVICE_PREFIX))
        .map((key) => key.slice(DEVICE_PREFIX.length));
      const devices = await Promise.all(ids.map(selectDevice));
      return devices.filter((device): device is EnrolledDevice => device?.waiting !== undefined);
    },
    writeDevice: (device: EnrolledDevice) => store.write(`${DEVICE_PREFIX}${device.instanceId}`, device),
    removeDevice: (instanceId: string) => store.remove(`${DEVICE_PREFIX}${instanceId}`),
  };
}

export type DeviceStore = ReturnType<typeof createDeviceStore>;
