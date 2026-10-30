import { hostname } from 'node:os';
import type { RemoteEnrollment, RemoteSnapshot } from '@shinsa/core';
import {
  type ConnectClaim,
  DomainError,
  type RequestOrigin,
  resolveEnrollUrl,
  resolveRemoteHookUrl,
  verifyConnectToken,
} from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import { runCommandOrThrow } from '../shell/index.ts';
import { type ChannelHost, type ChannelPeer, RemoteChannel } from './channel.ts';
import { ControlClient } from './control.ts';
import { Enrollments } from './enrollments.ts';
import { PAIR_POLL_MS, type PairedMachine, Pairing } from './pairing.ts';
import { RemoteStore } from './store.ts';
import { type StartConnector, TunnelSupervisor, type TunnelTimings } from './supervisor.ts';

export { type ChannelPeer, RemoteChannel } from './channel.ts';
export { createInstalledConnector } from './connector.ts';
export { ControlClient } from './control.ts';
export { Enrollments } from './enrollments.ts';
export { isTunnelRequest, resolveChannelOriginRefusal, resolveTunnelRoute } from './guard.ts';
export { resolveLocalOnlyRoute } from './local-only.ts';
export { REMOTE_FILE, RemoteStore } from './store.ts';
export { type StartConnector, TunnelSupervisor } from './supervisor.ts';

const remoteRequests = new WeakSet<Request>();

function isAnyChannel() {
  return true;
}

export function markRemoteRequest(request: Request) {
  remoteRequests.add(request);
  return request;
}

export function resolveRequestOrigin(request: Request): RequestOrigin {
  return remoteRequests.has(request) ? 'remote' : 'local';
}

export type { RemoteEnrollment, RemoteSnapshot } from '@shinsa/core';

const DEVICE_NAME_LIMIT = 60;

export interface RemoteOptions {
  path: string;
  control?: ControlClient;
  connect: StartConnector;
  ping?: (url: string) => Promise<boolean>;
  localUrl: () => string;
  version: string;
  maxBodyBytes: number;
  timings?: TunnelTimings;
  now?: () => number;
  machineName: string;
  openUrl: (url: string) => Promise<void>;
  pairPollMs?: number;
}

type ChannelParts = Pick<ChannelHost, 'hub' | 'respond'>;

export function resolveMachineName(name = hostname()) {
  const bare = name.replace(/\.local$/i, '');
  if (!bare) return 'Mac';
  if (bare !== bare.toUpperCase()) return bare;
  return bare
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
}

export async function openRemoteUrl(url: string, cwd: string) {
  await runCommandOrThrow(['open', url], cwd);
}

export function createUrlOpener(cwd: string) {
  return (url: string) => openRemoteUrl(url, cwd);
}

export async function requestHealth(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return response.ok;
  } catch {
    return false;
  }
}

export class Remote {
  readonly store: RemoteStore;
  readonly control: ControlClient;
  readonly enrollments: Enrollments;
  readonly supervisor: TunnelSupervisor;
  readonly #options: RemoteOptions;
  readonly #now: () => number;
  readonly #channels = new Set<RemoteChannel>();
  readonly #listeners = new Set<() => void>();
  #pairing: Pairing | null = null;

  constructor(options: RemoteOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.store = new RemoteStore(options.path);
    this.control = options.control ?? new ControlClient();
    this.enrollments = new Enrollments(this.#now);
    this.supervisor = new TunnelSupervisor({
      control: this.control,
      connect: options.connect,
      ping: options.ping ?? requestHealth,
      localUrl: options.localUrl,
      version: options.version,
      onRevoked: () => this.#forget(),
      ...(options.timings ? { timings: options.timings } : {}),
      now: this.#now,
    });
    this.supervisor.subscribe(() => this.#publish());
  }

  get appOrigin() {
    return this.control.origin;
  }

  get isEnabled() {
    const { file } = this.store;
    return file.enabled && file.credentials !== null;
  }

  get tunnelHost() {
    return this.store.file.credentials?.tunnelHost ?? null;
  }

  snapshot(): RemoteSnapshot {
    const { file } = this.store;
    return {
      paired: file.credentials !== null,
      enabled: this.isEnabled,
      status: this.supervisor.status,
      instanceId: file.credentials?.instanceId ?? null,
      owner: file.owner,
      machineName: this.#options.machineName,
      machineKey: file.machine?.publicKey ?? null,
      pairing: this.#pairing?.view ?? null,
      devices: file.devices,
    };
  }

  async startPairing() {
    if (this.store.file.credentials)
      throw new DomainError('remote_paired', 'This Mac is already paired. Remove it first to pair it again.');
    if (this.#pairing) return this.#pairing.view;
    const machine = await this.store.resolveMachineKey();
    const start = await this.control.requestPairStart({
      name: this.#options.machineName,
      publicKey: machine.publicKey,
      version: this.#options.version,
    });
    const pairing = new Pairing({
      control: this.control,
      start,
      pollMs: this.#options.pairPollMs ?? PAIR_POLL_MS,
      now: this.#now,
    });
    this.#pairing = pairing;
    this.#publish();
    void pairing.done.then((end) => {
      if (this.#pairing === pairing) this.#pairing = null;
      if (end.status === 'claimed') this.#recordPaired(end.machine);
      this.#publish();
    });
    await this.#options.openUrl(start.url).catch((error: unknown) => {
      log.warn('[Remote] Could not open the pairing page', { error: describeError(error) });
    });
    return pairing.view;
  }

  resolveHookUrl(scheduleId: string, token: string) {
    const { credentials } = this.store.file;
    if (!(credentials && this.isEnabled)) return null;
    return resolveRemoteHookUrl(credentials.instanceId, scheduleId, token, this.appOrigin);
  }

  cancelPairing() {
    this.#pairing?.cancel();
  }

  #recordPaired(machine: PairedMachine) {
    this.store.update((file) => ({
      ...file,
      credentials: machine.credentials,
      owner: machine.owner,
      enabled: true,
    }));
    log.info('[Remote] Paired', { instanceId: machine.credentials.instanceId, owner: machine.owner });
    this.start();
  }

  #assertPaired() {
    const { credentials } = this.store.file;
    if (!credentials) throw new DomainError('remote_not_paired', 'Turn on remote access first.');
    return credentials;
  }

  enable() {
    this.#assertPaired();
    this.store.update((file) => ({ ...file, enabled: true }));
    this.start();
    this.#publish();
  }

  async disable() {
    this.#assertPaired();
    this.store.update((file) => ({ ...file, enabled: false }));
    await this.stop();
    this.#publish();
  }

  async remove() {
    const credentials = this.#assertPaired();
    await this.stop();
    try {
      await this.control.requestRemoval(credentials.machineToken);
    } catch (error) {
      log.warn('[Remote] app.shinsa.dev did not confirm the removal', { error: describeError(error) });
    }
    this.store.update((file) => ({ ...file, credentials: null, owner: null, enabled: false, devices: [] }));
    this.#publish();
  }

  async createEnrollment(name: string): Promise<RemoteEnrollment> {
    const credentials = this.#assertPaired();
    const deviceName = name.trim().slice(0, DEVICE_NAME_LIMIT);
    if (!deviceName) throw new DomainError('device_name_missing', 'Name the device you are adding.');
    const machine = await this.store.resolveMachineKey();
    const { secret, expiresAt } = this.enrollments.create(deviceName);
    return {
      url: resolveEnrollUrl(credentials.instanceId, machine.publicKey, secret, this.appOrigin),
      name: deviceName,
      expiresAt,
    };
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #publish() {
    for (const listener of this.#listeners) listener();
  }

  start() {
    const { credentials } = this.store.file;
    if (!(this.isEnabled && credentials)) return;
    this.supervisor.start(credentials);
  }

  async stop() {
    this.#pairing?.cancel();
    this.#closeChannels(isAnyChannel);
    this.enrollments.clear();
    await this.supervisor.stop();
  }

  #forget() {
    this.store.update((file) => ({ ...file, credentials: null, owner: null, enabled: false }));
    this.#closeChannels(isAnyChannel);
    this.#publish();
  }

  verifyConnect(token: string | null): Promise<ConnectClaim | null> {
    const credentials = this.store.file.credentials;
    if (!(token && credentials && this.isEnabled)) return Promise.resolve(null);
    return verifyConnectToken(credentials.connectKey, token, credentials.instanceId, this.#now());
  }

  openChannel(peer: ChannelPeer, parts: ChannelParts) {
    const channel = new RemoteChannel(peer, {
      ...parts,
      resolveMachineKey: () => this.store.resolveMachineKey(),
      isEnrolled: (device) => this.store.selectDevice(device) !== null,
      redeemEnrollment: async (proof, keys) => {
        const name = await this.enrollments.redeem(proof, keys);
        if (name === null) return false;
        this.store.upsertDevice({
          publicKey: keys.device,
          name,
          enrolledAt: this.#now(),
          lastSeenAt: null,
        });
        this.#publish();
        return true;
      },
      recordSeen: (device) => this.store.recordDeviceSeen(device, this.#now()),
      maxBodyBytes: this.#options.maxBodyBytes,
    });
    this.#channels.add(channel);
    return channel;
  }

  closeChannel(channel: RemoteChannel) {
    channel.close();
    this.#channels.delete(channel);
  }

  #closeChannels(match: (channel: RemoteChannel) => boolean) {
    for (const channel of [...this.#channels]) {
      if (!match(channel)) continue;
      channel.fail('Remote access to this Mac changed.');
      this.#channels.delete(channel);
    }
  }

  removeDevice(publicKey: string) {
    const removed = this.store.removeDevice(publicKey);
    this.#closeChannels((channel) => channel.device === publicKey);
    this.#publish();
    return removed;
  }
}
