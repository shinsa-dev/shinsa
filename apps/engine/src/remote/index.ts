import { randomBytes, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type {
  AccessRequest,
  PairingView,
  RemoteMember,
  RemoteSnapshot,
  RemoteUser,
  TaskGuest,
} from '@shinsa/core';
import {
  type ConnectChannel,
  type ConnectClaim,
  DomainError,
  type ScopedActor,
  MACHINE_FEATURES,
  type HandshakeKeys,
  isTeamPerson,
  MAX_INSTANCE_GUESTS,
  MAX_INSTANCE_MEMBERS,
  type RemoteAccess,
  type TunnelStatus,
  resolveClaimUrl,
  resolveEnrollUrl,
  resolveMemberPermissions,
  resolveRemoteHookUrl,
  serializeBase64Url,
  verifyConnectToken,
  verifyEnrollProof,
} from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import { resolveBrowserCommand } from '../shell/browser.ts';
import { runCommandOrThrow } from '../shell/index.ts';
import { RemoteAccessScope } from './access/index.ts';
import { type AccessAnswer, type ChannelHost, type ChannelPeer, RemoteChannel } from './channel.ts';
import {
  type PairedMachine,
  type PairingRun,
  RemoteControl,
  selectRemoteFailureTag,
} from './client/index.ts';
import {
  listTeamEntries,
  type RemoteDevice,
  RemoteStore,
  type StoredHandoff,
  type StoredLink,
  type TeamGrant,
} from './store.ts';
import { Tunnel, type TunnelConnectorLayer, type TunnelPing } from './tunnel/index.ts';

export { type ChannelPeer, RemoteChannel } from './channel.ts';
export { createInstalledConnector } from './connector/installed.ts';
export { createRefusedConnector } from './connector/refused.ts';
export { TunnelConnectFailed } from './connector/schema.ts';
export { TunnelConnector } from './connector/service.ts';
export type { TunnelConnectorLayer } from './tunnel/index.ts';
export { RemoteControl } from './client/index.ts';
export { REMOTE_FILE, RemoteStore } from './store.ts';

const REMOTE_ACCESS_CHANGED = 'Remote access to this machine changed.';

export type { RemoteSnapshot } from '@shinsa/core';

const SECRET_BYTES = 32;

const MAX_REQUESTS = 20;

type ProofKeys = Pick<HandshakeKeys, 'machine' | 'device' | 'clientEphemeral'>;

export interface RemoteOptions {
  path: string;
  control?: RemoteControl;
  connector: TunnelConnectorLayer;
  ping?: TunnelPing;
  localUrl: () => string;
  version: string;
  maxBodyBytes: number;
  now?: () => number;
  machineName: string;
  openUrl: (url: string) => Promise<void>;
}

interface ChannelParts {
  readonly hub: ChannelHost['hub'];
  readonly terminals: ChannelHost['terminals'];
  readonly respond: (request: Request, guest: ScopedActor | null, userId: string) => Promise<Response>;
}

export type HandoffClaimer = (taskId: string, guest: TaskGuest) => Promise<string | null>;

export type GuestLeaver = (userIds: string[]) => void;

const HANDOFF_NOT_ENABLED =
  'Turn on remote access in Settings → General to hand off this task. Its link works once this machine is reachable.';

const HANDOFF_UNAVAILABLE = 'This machine cannot hand off tasks right now. Try again in a moment.';

const GUEST_FALLBACK_LOGIN = 'guest';

const NOWHERE: ScopedActor['scope'] = { kind: 'task', taskId: '' };

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

export class Remote {
  readonly store: RemoteStore;
  readonly control: RemoteControl;
  readonly access = new RemoteAccessScope();
  readonly #tunnel: Tunnel;
  #tunnelStatus: TunnelStatus = 'off';
  readonly #options: RemoteOptions;
  readonly #now: () => number;
  readonly #channels = new Map<RemoteChannel, () => void>();
  readonly #spentConnects = new Map<string, number>();
  readonly #listeners = new Set<() => void>();
  readonly #waiters = new Map<string, ((approved: boolean) => void)[]>();
  #pairing: { view: PairingView; run: PairingRun } | null = null;
  #claimer: HandoffClaimer | null = null;
  #leaver: GuestLeaver | null = null;
  #guestRevision = 0;
  readonly #teamScopes = new Map<string, string>();

  constructor(options: RemoteOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.store = new RemoteStore(options.path);
    this.control = options.control ?? new RemoteControl();
    this.#tunnel = new Tunnel({
      control: this.control,
      connector: options.connector,
      ping: options.ping,
      version: options.version,
      localUrl: options.localUrl,
      signingKey: async () => (await this.store.resolveSigningKey()).publicKey,
      guestRevision: () => this.#guestRevision,
      guests: () => this.store.file.guests,
      onAccess: (access, guests) => this.#recordAccess(access, guests),
      onTeams: (teams) => {
        if (this.store.recordTeams(teams)) this.#publish();
      },
      onStatus: (status) => {
        this.#tunnelStatus = status;
        this.#publish();
      },
      onRevoked: () => this.#forget(),
    });
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

  isOwner(userId: string | null) {
    return userId !== null && this.store.file.access?.owner.id === userId;
  }

  snapshot(): RemoteSnapshot {
    const { file } = this.store;
    return {
      paired: file.credentials !== null,
      enabled: this.isEnabled,
      status: this.#tunnelStatus,
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
      throw new DomainError({ code: 'remote_paired', message: 'This machine is already paired.' });
    if (this.#pairing) return this.#pairing.view;
    const machine = await this.store.resolveMachineKey();
    const start = await this.control.requestPairStart({
      name: this.#options.machineName,
      publicKey: machine.publicKey,
      version: this.#options.version,
      features: [...MACHINE_FEATURES],
    });
    const pairing = {
      view: { claimCode: start.claimCode, url: start.url, expiresAt: start.expiresAt },
      run: this.control.startPairing(start, machine),
    };
    this.#pairing = pairing;
    this.#publish();
    void pairing.run.done.then((end) => {
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
    this.#pairing?.run.cancel();
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
    if (!credentials)
      throw new DomainError({ code: 'remote_not_paired', message: 'Turn on remote access first.' });
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
      guests: [],
      handoffs: [],
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

  async #matchHandoff(proof: string, keys: ProofKeys) {
    for (const handoff of this.store.file.handoffs) {
      if (await verifyEnrollProof(handoff.secret, proof, keys)) return handoff;
    }
    return null;
  }

  handleClaims(claimer: HandoffClaimer) {
    this.#claimer = claimer;
  }

  handleLeaves(leaver: GuestLeaver) {
    this.#leaver = leaver;
  }

  #updateGuests(change: (guests: RemoteMember[]) => RemoteMember[]) {
    this.#guestRevision += 1;
    this.store.update((file) => ({ ...file, guests: change(file.guests) }));
  }

  #resolveHandoffUrl(handoff: StoredHandoff) {
    const { credentials, machine } = this.store.file;
    const fragment = {
      instanceId: credentials?.instanceId ?? '',
      machineKey: machine?.publicKey ?? '',
      secret: handoff.secret,
      invite: handoff.invite,
    };
    return resolveClaimUrl(fragment, this.appOrigin);
  }

  async createHandoff(taskId: string) {
    const { credentials } = this.store.file;
    if (!(credentials && this.isEnabled))
      throw new DomainError({ code: 'remote_not_enabled', message: HANDOFF_NOT_ENABLED });
    const existing = this.store.file.handoffs.find((entry) => entry.taskId === taskId);
    if (existing) return this.#resolveHandoffUrl(existing);
    await this.store.resolveMachineKey();
    const { token } = await this.control.requestHandoff(credentials.machineToken);
    const handoff: StoredHandoff = {
      taskId,
      secret: serializeBase64Url(new Uint8Array(randomBytes(SECRET_BYTES))),
      invite: token,
      createdAt: this.#now(),
    };
    this.store.update((file) => ({ ...file, handoffs: [...file.handoffs, handoff] }));
    return this.#resolveHandoffUrl(handoff);
  }

  async #retireHandoff(handoff: StoredHandoff) {
    this.store.update((file) => ({
      ...file,
      handoffs: file.handoffs.filter((entry) => entry.invite !== handoff.invite),
    }));
    const { credentials } = this.store.file;
    if (!credentials) return;
    try {
      await this.control.requestHandoffRemoval(credentials.machineToken, handoff.invite);
    } catch (error) {
      log.warn('[Remote] Shinsa Cloud did not turn off a hand-off link', { error: describeError(error) });
    }
  }

  async #addGuest(userId: string): Promise<RemoteMember | string> {
    const { credentials } = this.store.file;
    if (!credentials) return HANDOFF_UNAVAILABLE;
    try {
      return await this.control.requestGuestAddition(credentials.machineToken, userId);
    } catch (error) {
      if (selectRemoteFailureTag(error) === 'GuestsFull')
        return `This machine already has ${MAX_INSTANCE_GUESTS} people working on its tasks. Ask its owner to remove one.`;
      log.warn('[Remote] Could not add the guest a task was handed to', { error: describeError(error) });
      return HANDOFF_UNAVAILABLE;
    }
  }

  async #claimHandoff(
    handoff: StoredHandoff,
    device: string,
    name: string | null,
    userId: string
  ): Promise<AccessAnswer> {
    const user = await this.#resolveRequester(userId);
    if (typeof user === 'string') return { kind: 'refused', reason: user };
    if (!this.#claimer) return { kind: 'refused', reason: HANDOFF_UNAVAILABLE };
    const refusal = await this.#claimer(handoff.taskId, user);
    if (refusal) return { kind: 'refused', reason: refusal };
    if (!this.#hasAccess(user.id)) {
      const guest = await this.#addGuest(user.id);
      if (typeof guest === 'string') return { kind: 'refused', reason: guest };
      this.#updateGuests((guests) => [...guests.filter((entry) => entry.user.id !== user.id), guest]);
    }
    this.store.upsertDevice({
      publicKey: device,
      name: name ?? 'Browser',
      enrolledAt: this.#now(),
      lastSeenAt: null,
      userId: user.id,
      taskId: handoff.taskId,
    });
    await this.#retireHandoff(handoff);
    this.#publish();
    return { kind: 'admitted' };
  }

  async removeHandoff(taskId: string, guestId: string | null) {
    const handoff = this.store.file.handoffs.find((entry) => entry.taskId === taskId);
    if (handoff) await this.#retireHandoff(handoff);
    const removed = this.store.file.devices.filter((device) => device.taskId === taskId);
    for (const device of removed) this.store.removeDevice(device.publicKey);
    const keys = new Set(removed.map((device) => device.publicKey));
    this.#closeChannels((channel) => channel.device !== null && keys.has(channel.device));
    if (guestId) await this.#removeGuest(guestId);
    this.#publish();
  }

  async #removeGuest(guestId: string) {
    const { credentials, devices, guests } = this.store.file;
    const handedMore = devices.some((device) => device.userId === guestId && device.taskId);
    if (handedMore || !guests.some((guest) => guest.user.id === guestId)) return;
    if (credentials) await this.control.requestGuestRemoval(credentials.machineToken, guestId);
    this.#updateGuests((current) => current.filter((guest) => guest.user.id !== guestId));
  }

  #selectPerson(userId: string): TaskGuest {
    const { access, guests, teams } = this.store.file;
    const users = [access?.owner, ...(access?.members ?? []).map((member) => member.user)];
    const teammates = teams.flatMap((team) => [team.owner, ...team.members.map((member) => member.user)]);
    const known = [...users, ...guests.map((guest) => guest.user), ...teammates].find(
      (user) => user?.id === userId
    );
    return known ?? { id: userId, login: GUEST_FALLBACK_LOGIN, name: null, avatarUrl: null };
  }

  #resolveScope(enrolled: RemoteDevice): ScopedActor['scope'] | null {
    if (enrolled.taskId) return { kind: 'task', taskId: enrolled.taskId };
    if (!enrolled.teamId || this.#hasAccess(enrolled.userId)) return null;
    const team = this.#selectTeamAccess(enrolled.userId, enrolled.teamId);
    if (!team) return NOWHERE;
    return { kind: 'team', teamId: team.id, permissions: resolveMemberPermissions(team, enrolled.userId) };
  }

  #resolveGuest(device: string): ScopedActor | null {
    const enrolled = this.store.selectDevice(device);
    const scope = enrolled ? this.#resolveScope(enrolled) : null;
    if (!(enrolled && scope)) return null;
    if (scope.kind === 'team') this.#teamScopes.set(device, JSON.stringify(scope));
    const { id, login, name, avatarUrl } = this.#selectPerson(enrolled.userId);
    return { id, login, name, avatarUrl, scope };
  }

  #selectTeamAccess(userId: string, teamId: string) {
    const team = this.store.selectTeam(teamId);
    const reaches =
      team !== null &&
      this.store.selectTeamKey(teamId) !== null &&
      !this.isOwner(userId) &&
      isTeamPerson(team, userId);
    return reaches ? team : null;
  }

  resolveTeamGrant(userId: string, teamId: string) {
    if (!(this.isEnabled && this.#selectTeamAccess(userId, teamId))) return null;
    const existing = this.store.selectGrant(userId, teamId);
    if (existing) return existing.secret;
    const grant: TeamGrant = {
      userId,
      teamId,
      secret: serializeBase64Url(new Uint8Array(randomBytes(SECRET_BYTES))),
    };
    this.store.writeGrant(grant);
    return grant.secret;
  }

  #syncTeamAccess() {
    const outside = (userId: string, teamId: string) => !this.#selectTeamAccess(userId, teamId);
    this.store.removeGrantsWhere((grant) => outside(grant.userId, grant.teamId));
    const removed = new Set(
      this.store.removeDevicesWhere(
        (device) => device.teamId != null && outside(device.userId, device.teamId)
      )
    );
    const narrowed = new Set(
      [...this.#teamScopes].flatMap(([device, opened]) => {
        const enrolled = this.store.selectDevice(device);
        const scope = enrolled ? this.#resolveScope(enrolled) : null;
        return JSON.stringify(scope) === opened ? [] : [device];
      })
    );
    for (const device of [...removed, ...narrowed]) this.#teamScopes.delete(device);
    this.#closeChannels(
      (channel) => channel.device !== null && (removed.has(channel.device) || narrowed.has(channel.device))
    );
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
    const handoff = await this.#matchHandoff(proof, keys);
    if (handoff) return this.#claimHandoff(handoff, keys.device, name, userId);
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
    const answer = this.#awaitDecision(request.id);
    this.#publish();
    return answer;
  }

  async #matchGrant(userId: string, proof: string, keys: ProofKeys) {
    for (const grant of this.store.listGrants(userId)) {
      if (!this.#selectTeamAccess(userId, grant.teamId)) continue;
      if (await verifyEnrollProof(grant.secret, proof, keys)) return grant;
    }
    return null;
  }

  async #admitTeammate(proof: string, keys: ProofKeys, name: string | null, userId: string) {
    const grant = await this.#matchGrant(userId, proof, keys);
    if (!grant) return false;
    this.store.upsertDevice({
      publicKey: keys.device,
      name: name ?? 'Browser',
      enrolledAt: this.#now(),
      lastSeenAt: null,
      userId,
      ...(this.#hasAccess(userId) ? {} : { teamId: grant.teamId }),
    });
    this.#publish();
    return true;
  }

  async grantTeammate(userId: string, teamId: string) {
    const credentials = this.#assertPaired();
    const access = this.store.file.access;
    const team = this.store.selectTeam(teamId);
    if (!(team && this.store.selectTeamKey(teamId)))
      throw new DomainError({ code: 'team_not_found', message: 'This machine is not in that team.' });
    if (!(access && this.#selectTeamAccess(userId, teamId)))
      throw new DomainError({
        code: 'teammate_not_found',
        message: 'No one else in that team has that GitHub account.',
      });
    if (!access.members.some((member) => member.user.id === userId)) {
      const member = await this.#requestMemberAddition(credentials.machineToken, userId);
      this.#recordAccess({ ...access, members: [...access.members, member] });
    }
    this.resolveTeamGrant(userId, teamId);
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
    if (!request)
      throw new DomainError({
        code: 'request_not_found',
        message: 'That access request was already handled.',
      });
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
      if (selectRemoteFailureTag(error) === 'MembersFull')
        throw new DomainError({
          code: 'members_full',
          message: `This machine has ${MAX_INSTANCE_MEMBERS} members already.`,
        });
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
      throw new DomainError({
        code: 'member_not_found',
        message: 'No member with that GitHub account has access to this machine.',
      });
    await this.control.requestMemberRemoval(credentials.machineToken, userId);
    this.#recordAccess({
      ...access,
      members: access.members.filter((member) => member.user.id !== userId),
    });
  }

  #hasAccess(userId: string) {
    const { access } = this.store.file;
    if (!access) return false;
    return access.owner.id === userId || access.members.some((member) => member.user.id === userId);
  }

  #recordAccess(access: RemoteAccess, guests: RemoteMember[] = this.store.file.guests) {
    const before = this.store.file;
    const changed =
      JSON.stringify(access) !== JSON.stringify(before.access) ||
      JSON.stringify(guests) !== JSON.stringify(before.guests);
    if (changed) this.store.update((file) => ({ ...file, access, guests }));
    const allowed = new Set([access.owner.id, ...access.members.map((member) => member.user.id)]);
    const listed = new Set([...allowed, ...guests.map((guest) => guest.user.id)]);
    const left = before.guests.map((guest) => guest.user.id).filter((id) => !listed.has(id));
    if (left.length > 0) this.#leaver?.(left);
    const removed = new Set(this.store.removeDevicesOutside(allowed, listed));
    this.#closeChannels((channel) => channel.device !== null && removed.has(channel.device));
    if (changed || removed.size > 0) this.#publish();
  }

  #admits(device: string, userId: string) {
    const enrolled = this.store.selectDevice(device);
    if (enrolled?.userId !== userId) return false;
    return !enrolled.teamId || this.#resolveScope(enrolled) !== NOWHERE;
  }

  publish() {
    this.#publish();
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #publish() {
    this.#syncTeamAccess();
    for (const listener of this.#listeners) listener();
  }

  start() {
    const { credentials } = this.store.file;
    if (!(this.isEnabled && credentials)) return;
    this.#tunnel.start(credentials);
  }

  requestHeartbeat() {
    return this.#tunnel.requestHeartbeat();
  }

  async stop() {
    this.#pairing?.run.cancel();
    this.access.end();
    await this.#tunnel.stop();
  }

  #forget() {
    this.store.update((file) => ({
      ...file,
      credentials: null,
      owner: null,
      enabled: false,
      access: null,
      guests: [],
      handoffs: [],
      teams: [],
      teamKeys: [],
      grants: [],
    }));
    this.access.end();
    this.#publish();
  }

  verifyConnect(token: string | null, channel: ConnectChannel): Promise<ConnectClaim | null> {
    const credentials = this.store.file.credentials;
    if (!(token && credentials && this.isEnabled)) return Promise.resolve(null);
    const audience = { instanceId: credentials.instanceId, channel };
    return verifyConnectToken(credentials.connectKey, token, audience, this.#now());
  }

  spendConnect(claim: ConnectClaim) {
    const now = this.#now();
    for (const [nonce, expiresAt] of this.#spentConnects)
      if (expiresAt <= now) this.#spentConnects.delete(nonce);
    if (claim.expiresAt <= now || this.#spentConnects.has(claim.nonce)) return false;
    this.#spentConnects.set(claim.nonce, claim.expiresAt);
    return true;
  }

  openChannel(peer: ChannelPeer, parts: ChannelParts, userId: string) {
    const channel = new RemoteChannel(peer, {
      ...parts,
      respond: (request, guest) => parts.respond(request, guest, userId),
      resolveMachineKey: () => this.store.resolveMachineKey(),
      isEnrolled: (device) => this.#admits(device, userId),
      resolveGuest: (device) => this.#resolveGuest(device),
      isOwner: () => this.isOwner(userId),
      requestAccess: (proof, keys, name) => this.#requestAccess(proof, keys, name, userId),
      resumeAccess: (device) => this.#resumeAccess(device, userId),
      recordSeen: (device) => this.store.recordDeviceSeen(device, this.#now()),
      maxBodyBytes: this.#options.maxBodyBytes,
    });
    const release = this.access.acquire(() => {
      if (this.#channels.delete(channel)) channel.fail(REMOTE_ACCESS_CHANGED);
    });
    this.#channels.set(channel, release);
    return channel;
  }

  closeChannel(channel: RemoteChannel) {
    channel.close();
    this.#releaseChannel(channel);
  }

  #releaseChannel(channel: RemoteChannel) {
    const release = this.#channels.get(channel);
    this.#channels.delete(channel);
    release?.();
  }

  #closeChannels(match: (channel: RemoteChannel) => boolean) {
    for (const channel of [...this.#channels.keys()]) {
      if (!match(channel)) continue;
      this.#releaseChannel(channel);
      channel.fail(REMOTE_ACCESS_CHANGED);
    }
  }

  removeDevice(publicKey: string) {
    const removed = this.store.removeDevice(publicKey);
    this.#closeChannels((channel) => channel.device === publicKey);
    this.#publish();
    return removed;
  }
}
