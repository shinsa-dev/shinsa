import { randomBytes, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { AccessRequest, RemoteSnapshot, RemoteUser } from '@shinsa/core';
import {
  type ConnectClaim,
  DomainError,
  type HandshakeKeys,
  MAX_INSTANCE_MEMBERS,
  type RemoteAccess,
  type RequestOrigin,
  resolveEnrollUrl,
  resolveRemoteHookUrl,
  serializeBase64Url,
  verifyConnectToken,
  verifyEnrollProof,
} from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import { resolveBrowserCommand } from '../shell/browser.ts';
import { runCommandOrThrow } from '../shell/index.ts';
import { type AccessAnswer, type ChannelHost, type ChannelPeer, RemoteChannel } from './channel.ts';
import { ControlClient, ControlError } from './control.ts';
import { PAIR_POLL_MS, type PairedMachine, Pairing } from './pairing.ts';
import { listTeamEntries, RemoteStore, type StoredLink } from './store.ts';
import { type StartConnector, TunnelSupervisor, type TunnelTimings } from './supervisor.ts';

export { type ChannelPeer, RemoteChannel } from './channel.ts';
export { createInstalledConnector } from './connector.ts';
export { ControlClient } from './control.ts';
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

export type { RemoteSnapshot } from '@shinsa/core';

const SECRET_BYTES = 32;

const MAX_REQUESTS = 20;

type ProofKeys = Pick<HandshakeKeys, 'machine' | 'device' | 'clientEphemeral'>;

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
  if (!bare) return 'Machine';
  if (bare !== bare.toUpperCase()) return bare;
  return bare
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
}

export async function openRemoteUrl(url: string, cwd: string, command = resolveBrowserCommand(url)) {
  if (command) await runCommandOrThrow(command, cwd);
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
  readonly supervisor: TunnelSupervisor;
  readonly #options: RemoteOptions;
  readonly #now: () => number;
  readonly #channels = new Set<RemoteChannel>();
  readonly #listeners = new Set<() => void>();
  readonly #waiters = new Map<string, ((approved: boolean) => void)[]>();
  #pairing: Pairing | null = null;

  constructor(options: RemoteOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.store = new RemoteStore(options.path);
    this.control = options.control ?? new ControlClient();
    this.supervisor = new TunnelSupervisor({
      control: this.control,
      connect: options.connect,
      ping: options.ping ?? requestHealth,
      localUrl: options.localUrl,
      version: options.version,
      onRevoked: () => this.#forget(),
      onAccess: (access) => this.#recordAccess(access),
      onTeams: (teams) => {
        if (this.store.recordTeams(teams)) this.#publish();
      },
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
      access: file.access,
      link: file.credentials && file.machine && file.link ? this.#serializeLink(file.link) : null,
      requests: file.requests,
      teams: listTeamEntries(file),
    };
  }

  #serializeLink(link: StoredLink) {
    const { credentials, machine } = this.store.file;
    const fragment = {
      instanceId: credentials?.instanceId ?? '',
      machineKey: machine?.publicKey ?? '',
      secret: link.secret,
      invite: link.invite,
    };
    return { url: resolveEnrollUrl(fragment, this.appOrigin), createdAt: link.createdAt };
  }

  async startPairing() {
    if (this.store.file.credentials)
      throw new DomainError('remote_paired', 'This machine is already paired.');
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
      log.warn('[Remote] Shinsa Cloud did not confirm the removal', { error: describeError(error) });
    }
    this.store.update((file) => ({
      ...file,
      credentials: null,
      owner: null,
      enabled: false,
      devices: [],
      access: null,
      link: null,
      requests: [],
      teams: [],
      teamKeys: [],
      grants: [],
    }));
    this.#settleWaiters(false);
    this.#publish();
  }

  async createLink() {
    const credentials = this.#assertPaired();
    if (this.store.file.link) return;
    await this.store.resolveMachineKey();
    const { token } = await this.control.requestInvite(credentials.machineToken);
    const link: StoredLink = {
      secret: serializeBase64Url(new Uint8Array(randomBytes(SECRET_BYTES))),
      invite: token,
      createdAt: this.#now(),
    };
    this.store.update((file) => ({ ...file, link }));
    this.#publish();
  }

  async removeLink() {
    const credentials = this.#assertPaired();
    await this.control.requestInviteRemoval(credentials.machineToken);
    this.store.update((file) => ({ ...file, link: null }));
    this.#publish();
  }

  async #matchesLink(proof: string, keys: ProofKeys) {
    const { link } = this.store.file;
    return link !== null && (await verifyEnrollProof(link.secret, proof, keys));
  }

  async #resolveRequester(userId: string): Promise<RemoteUser | string> {
    const { access, credentials } = this.store.file;
    if (!(access && credentials)) return 'This machine is still connecting. Try again in a moment.';
    if (access.owner.id === userId) return access.owner;
    try {
      return await this.control.requestRequester(credentials.machineToken, userId);
    } catch (error) {
      log.warn('[Remote] Could not look up who asked for access', { error: describeError(error) });
      return 'This machine could not check who you are. Try again in a moment.';
    }
  }

  async #requestAccess(
    proof: string,
    keys: ProofKeys,
    name: string | null,
    userId: string
  ): Promise<AccessAnswer> {
    if (!(await this.#matchesLink(proof, keys))) {
      if (await this.#admitTeammate(proof, keys, name, userId)) return { kind: 'admitted' };
      return { kind: 'refused', reason: 'This link was turned off. Ask for a new one.' };
    }
    const user = await this.#resolveRequester(userId);
    if (typeof user === 'string') return { kind: 'refused', reason: user };
    const earlier = this.store.file.requests.find((entry) => entry.publicKey === keys.device);
    const request: AccessRequest = {
      id: earlier?.id ?? randomUUID(),
      publicKey: keys.device,
      deviceName: name ?? earlier?.deviceName ?? 'Browser',
      user,
      requestedAt: earlier?.requestedAt ?? this.#now(),
    };
    this.store.update((file) => ({
      ...file,
      requests: earlier
        ? file.requests.map((entry) => (entry.id === request.id ? request : entry))
        : [...file.requests, request].slice(-MAX_REQUESTS),
    }));
    this.#publish();
    return this.#awaitDecision(request.id);
  }

  async #admitTeammate(proof: string, keys: ProofKeys, name: string | null, userId: string) {
    const grant = this.store.selectGrant(userId);
    if (!(grant && this.store.file.access?.members.some((member) => member.user.id === userId))) return false;
    const team = this.store.selectTeam(grant.teamId);
    const stored = this.store.selectTeamKey(grant.teamId);
    const inTeam = team?.owner.id === userId || team?.members.some((member) => member.user.id === userId);
    if (!(inTeam && stored && (await verifyEnrollProof(stored.key, proof, keys)))) return false;
    this.store.upsertDevice({
      publicKey: keys.device,
      name: name ?? 'Browser',
      enrolledAt: this.#now(),
      lastSeenAt: null,
      userId,
    });
    this.#publish();
    return true;
  }

  async grantTeammate(userId: string, teamId: string) {
    const credentials = this.#assertPaired();
    const access = this.store.file.access;
    const team = this.store.selectTeam(teamId);
    if (!(team && this.store.selectTeamKey(teamId)))
      throw new DomainError('team_not_found', 'This machine is not in that team.');
    const teammate = [team.owner, ...team.members.map((member) => member.user)].find(
      (user) => user.id === userId
    );
    if (!(access && teammate) || access.owner.id === userId)
      throw new DomainError('teammate_not_found', 'No one else in that team has that GitHub account.');
    if (!access.members.some((member) => member.user.id === userId)) {
      const member = await this.#requestMemberAddition(credentials.machineToken, userId);
      this.#recordAccess({ ...access, members: [...access.members, member] });
    }
    this.store.writeGrant({ userId, teamId });
    this.#publish();
  }

  #resumeAccess(device: string, userId: string): AccessAnswer | null {
    const request = this.store.file.requests.find(
      (entry) => entry.publicKey === device && entry.user.id === userId
    );
    return request ? this.#awaitDecision(request.id) : null;
  }

  #awaitDecision(requestId: string): AccessAnswer {
    const decided = new Promise<boolean>((resolve) => {
      this.#waiters.set(requestId, [...(this.#waiters.get(requestId) ?? []), resolve]);
    });
    return { kind: 'waiting', decided };
  }

  #findRequest(requestId: string) {
    const request = this.store.file.requests.find((entry) => entry.id === requestId);
    if (!request) throw new DomainError('request_not_found', 'That access request was already handled.');
    return request;
  }

  #settleRequest(request: AccessRequest, approved: boolean) {
    this.store.update((file) => ({
      ...file,
      requests: file.requests.filter((entry) => entry.id !== request.id),
    }));
    for (const resolve of this.#waiters.get(request.id) ?? []) resolve(approved);
    this.#waiters.delete(request.id);
    this.#publish();
  }

  #settleWaiters(approved: boolean) {
    for (const resolvers of this.#waiters.values()) for (const resolve of resolvers) resolve(approved);
    this.#waiters.clear();
  }

  async acceptRequest(requestId: string) {
    const credentials = this.#assertPaired();
    const request = this.#findRequest(requestId);
    const access = this.store.file.access;
    const joins =
      access !== null &&
      access.owner.id !== request.user.id &&
      !access.members.some((member) => member.user.id === request.user.id);
    if (joins) {
      const member = await this.#requestMemberAddition(credentials.machineToken, request.user.id);
      this.#recordAccess({ ...access, members: [...access.members, member] });
    }
    this.store.upsertDevice({
      publicKey: request.publicKey,
      name: request.deviceName,
      enrolledAt: this.#now(),
      lastSeenAt: null,
      userId: request.user.id,
    });
    this.#settleRequest(request, true);
  }

  async #requestMemberAddition(machineToken: string, userId: string) {
    try {
      return await this.control.requestMemberAddition(machineToken, userId);
    } catch (error) {
      if (error instanceof ControlError && error.status === 409)
        throw new DomainError('members_full', `This machine has ${MAX_INSTANCE_MEMBERS} members already.`);
      throw error;
    }
  }

  declineRequest(requestId: string) {
    this.#settleRequest(this.#findRequest(requestId), false);
  }

  async removeMember(userId: string) {
    const credentials = this.#assertPaired();
    const access = this.store.file.access;
    if (!access?.members.some((member) => member.user.id === userId))
      throw new DomainError(
        'member_not_found',
        'No member with that GitHub account has access to this machine.'
      );
    await this.control.requestMemberRemoval(credentials.machineToken, userId);
    this.#recordAccess({
      ...access,
      members: access.members.filter((member) => member.user.id !== userId),
    });
  }

  #recordAccess(access: RemoteAccess) {
    const changed = JSON.stringify(access) !== JSON.stringify(this.store.file.access);
    if (changed) this.store.update((file) => ({ ...file, access }));
    const allowed = new Set([access.owner.id, ...access.members.map((member) => member.user.id)]);
    const removed = new Set(this.store.removeDevicesOutside(allowed));
    this.store.removeGrantsOutside(allowed);
    this.#closeChannels((channel) => channel.device !== null && removed.has(channel.device));
    if (changed || removed.size > 0) this.#publish();
  }

  #admits(device: string, userId: string) {
    const enrolled = this.store.selectDevice(device);
    if (!enrolled) return false;
    const owner = this.store.file.access?.owner.id ?? userId;
    return (enrolled.userId ?? owner) === userId;
  }

  publish() {
    this.#publish();
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
    await this.supervisor.stop();
  }

  #forget() {
    this.store.update((file) => ({
      ...file,
      credentials: null,
      owner: null,
      enabled: false,
      access: null,
      teams: [],
      teamKeys: [],
      grants: [],
    }));
    this.#closeChannels(isAnyChannel);
    this.#publish();
  }

  verifyConnect(token: string | null): Promise<ConnectClaim | null> {
    const credentials = this.store.file.credentials;
    if (!(token && credentials && this.isEnabled)) return Promise.resolve(null);
    return verifyConnectToken(credentials.connectKey, token, credentials.instanceId, this.#now());
  }

  openChannel(peer: ChannelPeer, parts: ChannelParts, userId: string) {
    const channel = new RemoteChannel(peer, {
      ...parts,
      resolveMachineKey: () => this.store.resolveMachineKey(),
      isEnrolled: (device) => this.#admits(device, userId),
      requestAccess: (proof, keys, name) => this.#requestAccess(proof, keys, name, userId),
      resumeAccess: (device) => this.#resumeAccess(device, userId),
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
      channel.fail('Remote access to this machine changed.');
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
