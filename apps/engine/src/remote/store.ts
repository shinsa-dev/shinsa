import { existsSync, readFileSync } from 'node:fs';
import {
  type MachineCredentials,
  parsePrivateKey,
  REMOTE_KEY_ALGORITHM,
  serializePrivateKey,
  serializePublicKey,
} from '@shinsa/core';
import { writeJsonFile } from '../config/index.ts';
import { describeError, log } from '../log/index.ts';

export const REMOTE_FILE = 'remote.json';

export interface RemoteDevice {
  publicKey: string;
  name: string;
  enrolledAt: number;
  lastSeenAt: number | null;
}

interface MachineKey {
  publicKey: string;
  privateKey: string;
}

export interface RemoteFile {
  version: 1;
  machine: MachineKey | null;
  credentials: MachineCredentials | null;
  owner: string | null;
  enabled: boolean;
  devices: RemoteDevice[];
}

type Fields = Record<string, unknown>;

const CREDENTIAL_FIELDS = ['instanceId', 'machineToken', 'tunnelToken', 'tunnelHost', 'connectKey'] as const;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMachine(value: unknown): MachineKey | null {
  if (!isFields(value) || typeof value.publicKey !== 'string' || typeof value.privateKey !== 'string')
    return null;
  return { publicKey: value.publicKey, privateKey: value.privateKey };
}

function readCredentials(value: unknown): MachineCredentials | null {
  if (!isFields(value)) return null;
  if (!CREDENTIAL_FIELDS.every((field) => typeof value[field] === 'string' && value[field] !== '')) {
    log.warn('[Remote] remote.json is missing part of its credentials; pair this Mac again');
    return null;
  }
  const fields = value as Record<(typeof CREDENTIAL_FIELDS)[number], string>;
  return {
    instanceId: fields.instanceId,
    machineToken: fields.machineToken,
    tunnelToken: fields.tunnelToken,
    tunnelHost: fields.tunnelHost,
    connectKey: fields.connectKey,
  };
}

function readDevices(value: unknown): RemoteDevice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isFields(entry) || typeof entry.publicKey !== 'string' || typeof entry.name !== 'string') return [];
    if (typeof entry.enrolledAt !== 'number') return [];
    const lastSeenAt = typeof entry.lastSeenAt === 'number' ? entry.lastSeenAt : null;
    return [{ publicKey: entry.publicKey, name: entry.name, enrolledAt: entry.enrolledAt, lastSeenAt }];
  });
}

export function createRemoteFile(): RemoteFile {
  return { version: 1, machine: null, credentials: null, owner: null, enabled: false, devices: [] };
}

export function readRemoteFile(path: string): RemoteFile {
  if (!existsSync(path)) return createRemoteFile();
  let fields: unknown;
  try {
    fields = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    log.warn('[Remote] remote.json could not be read; remote access is off', { error: describeError(error) });
    return createRemoteFile();
  }
  if (!isFields(fields)) return createRemoteFile();
  const credentials = readCredentials(fields.credentials);
  return {
    version: 1,
    machine: readMachine(fields.machine),
    credentials,
    owner: typeof fields.owner === 'string' ? fields.owner : null,
    enabled: credentials !== null && fields.enabled === true,
    devices: readDevices(fields.devices),
  };
}

export class RemoteStore {
  readonly path: string;
  #file: RemoteFile;
  #machineKey: CryptoKey | null = null;

  constructor(path: string) {
    this.path = path;
    this.#file = readRemoteFile(path);
  }

  get file(): RemoteFile {
    return this.#file;
  }

  update(change: (file: RemoteFile) => RemoteFile) {
    this.#file = change(this.#file);
    writeJsonFile(this.path, this.#file);
    return this.#file;
  }

  async resolveMachineKey() {
    const stored = this.#file.machine;
    const parsed = stored && (this.#machineKey ?? (await parsePrivateKey(stored.privateKey)));
    if (stored && parsed) {
      this.#machineKey = parsed;
      return { publicKey: stored.publicKey, privateKey: parsed };
    }
    const pair = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const machine = {
      publicKey: await serializePublicKey(pair.publicKey),
      privateKey: await serializePrivateKey(pair.privateKey),
    };
    this.update((file) => ({ ...file, machine }));
    this.#machineKey = (await parsePrivateKey(machine.privateKey)) as CryptoKey;
    return { publicKey: machine.publicKey, privateKey: this.#machineKey };
  }

  selectDevice(publicKey: string) {
    return this.#file.devices.find((device) => device.publicKey === publicKey) ?? null;
  }

  upsertDevice(device: RemoteDevice) {
    this.update((file) => ({
      ...file,
      devices: [...file.devices.filter((entry) => entry.publicKey !== device.publicKey), device],
    }));
  }

  removeDevice(publicKey: string) {
    const before = this.#file.devices.length;
    this.update((file) => ({
      ...file,
      devices: file.devices.filter((device) => device.publicKey !== publicKey),
    }));
    return this.#file.devices.length < before;
  }

  recordDeviceSeen(publicKey: string, at: number) {
    if (!this.selectDevice(publicKey)) return;
    this.update((file) => ({
      ...file,
      devices: file.devices.map((device) =>
        device.publicKey === publicKey ? { ...device, lastSeenAt: at } : device
      ),
    }));
  }
}
