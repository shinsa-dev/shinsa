import {
  type AccessRequest,
  type ConnectChannel,
  type ConnectClaim,
  DomainError,
  type GuestActor,
  MACHINE_FEATURES,
  MAX_INSTANCE_GUESTS,
  MAX_INSTANCE_MEMBERS,
  type PairingView,
  type RemoteAccess,
  type RemoteMember,
  type RemoteSnapshot,
  type RemoteTeam,
  type RemoteUserId,
  type TunnelStatus,
  resolveClaimUrl,
  resolveEnrollUrl,
  resolveRemoteHookUrl,
  verifyConnectToken,
  verifyEnrollProof,
} from '@shinsa/core';
import { Deferred, Effect, Exit, Fiber, Redacted, Ref } from 'effect';
import { describeError } from '../../log/redact.ts';
import type { AccessAnswer, ProofKeys, RemoteChannelHandle } from '../channel/schema.ts';
import { RemoteClient } from '../client/service.ts';
import type { PairedMachine, PairingEnd } from '../pairing/schema.ts';
import { Pairings } from '../pairing/service.ts';
import { listTeamEntries, type StoredHandoff, type StoredLink } from '../store.ts';
import {
  GUEST_FALLBACK_LOGIN,
  type GuestLeaver,
  type HandoffClaim,
  HANDOFF_NOT_ENABLED,
  HANDOFF_UNAVAILABLE,
  MAX_REQUESTS,
  REMOTE_ACCESS_CHANGED,
  type RemoteDefinition,
} from './schema.ts';

export const makeRemote = Effect.fn('Remote.make')(function* (definition: RemoteDefinition) {
  const client = yield* RemoteClient;
  const pairings = yield* Pairings;
  const { store, tunnel, access } = definition;
  const tunnelStatus = yield* Ref.make<TunnelStatus>('off');
  const pairing = yield* Ref.make<{ view: PairingView; fiber: Fiber.Fiber<PairingEnd> } | null>(null);
  const claimer = yield* Ref.make<HandoffClaim | null>(null);
  const leaver = yield* Ref.make<GuestLeaver | null>(null);
  const guestRevision = yield* Ref.make(0);
  const channels = yield* Ref.make<ReadonlyMap<RemoteChannelHandle, Effect.Effect<void>>>(new Map());
  const spentConnects = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
  const listeners = new Set<() => void>();
  const waiters = yield* Ref.make<ReadonlyMap<string, Deferred.Deferred<boolean>>>(new Map());

  const file = Effect.sync(() => store.file);

  const token = (machineToken: string) => Redacted.make(machineToken);

  const verifyProof = (secret: string, proof: string, keys: ProofKeys) =>
    Effect.promise(() => verifyEnrollProof(secret, proof, keys));

  const isEnabled = file.pipe(Effect.map((current) => current.enabled && current.credentials !== null));

  const tunnelHost = file.pipe(Effect.map((current) => current.credentials?.tunnelHost ?? null));

  const publish = Effect.sync(() => {
    for (const listener of listeners) listener();
  });

  const subscribe = (listener: () => void) =>
    Effect.sync(() => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });

  const serializeLink = Effect.fn('Remote.serializeLink')(function* (link: StoredLink) {
    const { credentials, machine } = yield* file;
    const fragment = {
      instanceId: credentials?.instanceId ?? '',
      machineKey: machine?.publicKey ?? '',
      secret: link.secret,
      invite: link.invite,
    };
    return { url: resolveEnrollUrl(fragment, definition.origin), createdAt: link.createdAt };
  });

  const snapshot = Effect.gen(function* () {
    const current = yield* file;
    const view: RemoteSnapshot = {
      paired: current.credentials !== null,
      enabled: yield* isEnabled,
      status: yield* Ref.get(tunnelStatus),
      instanceId: current.credentials?.instanceId ?? null,
      owner: current.owner,
      machineName: definition.machineName,
      machineKey: current.machine?.publicKey ?? null,
      pairing: (yield* Ref.get(pairing))?.view ?? null,
      devices: current.devices,
      access: current.access,
      link:
        current.credentials && current.machine && current.link ? yield* serializeLink(current.link) : null,
      requests: current.requests,
      teams: listTeamEntries(current),
    };
    return view;
  }).pipe(Effect.withSpan('Remote.snapshot'));

  const assertPaired = Effect.gen(function* () {
    const { credentials } = yield* file;
    if (!credentials)
      return yield* new DomainError({ code: 'remote_not_paired', message: 'Turn on remote access first.' });
    return credentials;
  });

  const update = (change: Parameters<typeof store.update>[0]) => Effect.sync(() => store.update(change));

  const start = Effect.gen(function* () {
    const { credentials } = yield* file;
    if (!((yield* isEnabled) && credentials)) return;
    yield* tunnel.start(credentials);
  }).pipe(Effect.withSpan('Remote.start'));

  const cancelPairing = Effect.gen(function* () {
    const current = yield* Ref.get(pairing);
    if (current) yield* Effect.forkDetach(Fiber.interrupt(current.fiber));
  }).pipe(Effect.withSpan('Remote.cancelPairing'));

  const stop = Effect.gen(function* () {
    yield* cancelPairing;
    yield* access.end;
    yield* tunnel.stop;
  }).pipe(Effect.withSpan('Remote.stop'));

  const recordPaired = Effect.fn('Remote.recordPaired')(function* (machine: PairedMachine) {
    yield* update((current) => ({
      ...current,
      credentials: machine.credentials,
      owner: machine.owner,
      enabled: true,
    }));
    yield* Effect.logInfo('[Remote] Paired').pipe(
      Effect.annotateLogs({ instanceId: machine.credentials.instanceId, owner: machine.owner })
    );
    yield* start;
  });

  const startPairing = Effect.gen(function* () {
    if ((yield* file).credentials)
      return yield* new DomainError({ code: 'remote_paired', message: 'This machine is already paired.' });
    const existing = yield* Ref.get(pairing);
    if (existing) return existing.view;
    const machine = yield* definition.machineKey;
    const started = yield* client.pairing.start({
      name: definition.machineName,
      publicKey: machine.publicKey,
      version: definition.version,
      features: [...MACHINE_FEATURES],
    });
    const fiber = yield* Effect.forkDetach(pairings.await(started, machine));
    const run = {
      view: { claimCode: started.claimCode, url: started.url, expiresAt: started.expiresAt },
      fiber,
    };
    yield* Ref.set(pairing, run);
    yield* publish;
    yield* Effect.forkDetach(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(fiber);
        yield* Ref.update(pairing, (current) => (current === run ? null : current));
        if (Exit.isSuccess(exit) && exit.value.status === 'claimed') yield* recordPaired(exit.value.machine);
        yield* publish;
      })
    );
    yield* definition
      .openUrl(started.url)
      .pipe(
        Effect.catch((failure) =>
          Effect.logWarning('[Remote] Could not open the pairing page').pipe(
            Effect.annotateLogs({ error: failure.message })
          )
        )
      );
    return run.view;
  }).pipe(Effect.withSpan('Remote.startPairing'));

  const resolveHookUrl = Effect.fn('Remote.resolveHookUrl')(function* (
    scheduleId: string,
    hookToken: string
  ) {
    const { credentials } = yield* file;
    if (!(credentials && (yield* isEnabled))) return null;
    return resolveRemoteHookUrl(credentials.instanceId, scheduleId, hookToken, definition.origin);
  });

  const enable = Effect.gen(function* () {
    yield* assertPaired;
    yield* update((current) => ({ ...current, enabled: true }));
    yield* start;
    yield* publish;
  }).pipe(Effect.withSpan('Remote.enable'));

  const disable = Effect.gen(function* () {
    yield* assertPaired;
    yield* update((current) => ({ ...current, enabled: false }));
    yield* stop;
    yield* publish;
  }).pipe(Effect.withSpan('Remote.disable'));

  const settleWaiters = Effect.fn('Remote.settleWaiters')(function* (approved: boolean) {
    const waiting = yield* Ref.getAndSet(waiters, new Map());
    for (const decided of waiting.values()) yield* Deferred.succeed(decided, approved);
  });

  const remove = Effect.gen(function* () {
    const credentials = yield* assertPaired;
    yield* stop;
    yield* client.machine
      .remove(token(credentials.machineToken))
      .pipe(
        Effect.catch((failure) =>
          Effect.logWarning('[Remote] Shinsa Cloud did not confirm the removal').pipe(
            Effect.annotateLogs({ error: describeError(failure) })
          )
        )
      );
    yield* update((current) => ({
      ...current,
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
    yield* settleWaiters(false);
    yield* publish;
  }).pipe(Effect.withSpan('Remote.remove'));

  const createLink = Effect.gen(function* () {
    const credentials = yield* assertPaired;
    if ((yield* file).link) return;
    yield* definition.machineKey;
    const { token: invite } = yield* client.machine.createInvite(token(credentials.machineToken));
    const link: StoredLink = { secret: yield* definition.secret, invite, createdAt: yield* definition.now };
    yield* update((current) => ({ ...current, link }));
    yield* publish;
  }).pipe(Effect.withSpan('Remote.createLink'));

  const removeLink = Effect.gen(function* () {
    const credentials = yield* assertPaired;
    yield* client.machine.removeInvite(token(credentials.machineToken));
    yield* update((current) => ({ ...current, link: null }));
    yield* publish;
  }).pipe(Effect.withSpan('Remote.removeLink'));

  const matchesLink = Effect.fn('Remote.matchesLink')(function* (proof: string, keys: ProofKeys) {
    const { link } = yield* file;
    return link !== null && (yield* verifyProof(link.secret, proof, keys));
  });

  const matchHandoff = Effect.fn('Remote.matchHandoff')(function* (proof: string, keys: ProofKeys) {
    for (const handoff of (yield* file).handoffs) {
      if (yield* verifyProof(handoff.secret, proof, keys)) return handoff;
    }
    return null;
  });

  const handleClaims = (claim: HandoffClaim) => Ref.set(claimer, claim);

  const handleLeaves = (leave: GuestLeaver) => Ref.set(leaver, leave);

  const updateGuests = Effect.fn('Remote.updateGuests')(function* (
    change: (guests: RemoteMember[]) => RemoteMember[]
  ) {
    yield* Ref.update(guestRevision, (revision) => revision + 1);
    yield* update((current) => ({ ...current, guests: change(current.guests) }));
  });

  const resolveHandoffUrl = Effect.fn('Remote.resolveHandoffUrl')(function* (handoff: StoredHandoff) {
    const { credentials, machine } = yield* file;
    const fragment = {
      instanceId: credentials?.instanceId ?? '',
      machineKey: machine?.publicKey ?? '',
      secret: handoff.secret,
      invite: handoff.invite,
    };
    return resolveClaimUrl(fragment, definition.origin);
  });

  const createHandoff = Effect.fn('Remote.createHandoff')(function* (taskId: string) {
    const { credentials, handoffs } = yield* file;
    if (!(credentials && (yield* isEnabled)))
      return yield* new DomainError({ code: 'remote_not_enabled', message: HANDOFF_NOT_ENABLED });
    const existing = handoffs.find((entry) => entry.taskId === taskId);
    if (existing) return yield* resolveHandoffUrl(existing);
    yield* definition.machineKey;
    const { token: invite } = yield* client.machine.createHandoff(token(credentials.machineToken));
    const handoff: StoredHandoff = {
      taskId,
      secret: yield* definition.secret,
      invite,
      createdAt: yield* definition.now,
    };
    yield* update((current) => ({ ...current, handoffs: [...current.handoffs, handoff] }));
    return yield* resolveHandoffUrl(handoff);
  });

  const retireHandoff = Effect.fn('Remote.retireHandoff')(function* (handoff: StoredHandoff) {
    yield* update((current) => ({
      ...current,
      handoffs: current.handoffs.filter((entry) => entry.invite !== handoff.invite),
    }));
    const { credentials } = yield* file;
    if (!credentials) return;
    yield* client.machine
      .removeHandoff(token(credentials.machineToken), handoff.invite)
      .pipe(
        Effect.catch((failure) =>
          Effect.logWarning('[Remote] Shinsa Cloud did not turn off a hand-off link').pipe(
            Effect.annotateLogs({ error: describeError(failure) })
          )
        )
      );
  });

  const addGuest = Effect.fn('Remote.addGuest')(function* (userId: string) {
    const { credentials } = yield* file;
    if (!credentials) return HANDOFF_UNAVAILABLE;
    return yield* client.machine.addGuest(token(credentials.machineToken), userId as RemoteUserId).pipe(
      Effect.catchTag('GuestsFull', () =>
        Effect.succeed(
          `This machine already has ${MAX_INSTANCE_GUESTS} people working on its tasks. Ask its owner to remove one.`
        )
      ),
      Effect.catch((failure) =>
        Effect.logWarning('[Remote] Could not add the guest a task was handed to').pipe(
          Effect.annotateLogs({ error: describeError(failure) }),
          Effect.as(HANDOFF_UNAVAILABLE)
        )
      )
    );
  });

  const hasAccess = Effect.fn('Remote.hasAccess')(function* (userId: string) {
    const current = (yield* file).access;
    if (!current) return false;
    return current.owner.id === userId || current.members.some((member) => member.user.id === userId);
  });

  const resolveRequester = Effect.fn('Remote.resolveRequester')(function* (userId: string) {
    const { access: known, credentials } = yield* file;
    if (!(known && credentials)) return 'This machine is still connecting. Try again in a moment.';
    if (known.owner.id === userId) return known.owner;
    return yield* client.machine
      .findRequester(token(credentials.machineToken), userId as RemoteUserId)
      .pipe(
        Effect.catch((failure) =>
          Effect.logWarning('[Remote] Could not look up who asked for access').pipe(
            Effect.annotateLogs({ error: describeError(failure) }),
            Effect.as('This machine could not check who you are. Try again in a moment.')
          )
        )
      );
  });

  const closeChannels = Effect.fn('Remote.closeChannels')(function* (
    match: (device: string | null) => boolean
  ) {
    for (const [channel, release] of yield* Ref.get(channels)) {
      if (!match(yield* channel.device)) continue;
      yield* releaseChannel(channel);
      yield* release;
      yield* channel.fail(REMOTE_ACCESS_CHANGED);
    }
  });

  const releaseChannel = Effect.fn('Remote.releaseChannel')(function* (channel: RemoteChannelHandle) {
    return yield* Ref.modify(
      channels,
      (current): [boolean, ReadonlyMap<RemoteChannelHandle, Effect.Effect<void>>] => {
        if (!current.has(channel)) return [false, current];
        const rest = new Map(current);
        rest.delete(channel);
        return [true, rest];
      }
    );
  });

  const claimHandoff = Effect.fn('Remote.claimHandoff')(function* (
    handoff: StoredHandoff,
    device: string,
    name: string | null,
    userId: string
  ) {
    const user = yield* resolveRequester(userId);
    if (typeof user === 'string') return { kind: 'refused', reason: user } satisfies AccessAnswer;
    const claim = yield* Ref.get(claimer);
    if (!claim) return { kind: 'refused', reason: HANDOFF_UNAVAILABLE } satisfies AccessAnswer;
    const refusal = yield* claim(handoff.taskId, user);
    if (refusal) return { kind: 'refused', reason: refusal } satisfies AccessAnswer;
    if (!(yield* hasAccess(user.id))) {
      const guest = yield* addGuest(user.id);
      if (typeof guest === 'string') return { kind: 'refused', reason: guest } satisfies AccessAnswer;
      yield* updateGuests((guests) => [...guests.filter((entry) => entry.user.id !== user.id), guest]);
    }
    const enrolledAt = yield* definition.now;
    yield* Effect.sync(() =>
      store.upsertDevice({
        publicKey: device,
        name: name ?? 'Browser',
        enrolledAt,
        lastSeenAt: null,
        userId: user.id,
        taskId: handoff.taskId,
      })
    );
    yield* retireHandoff(handoff);
    yield* publish;
    return { kind: 'admitted' } satisfies AccessAnswer;
  });

  const removeGuest = Effect.fn('Remote.removeGuest')(function* (guestId: string) {
    const { credentials, devices, guests } = yield* file;
    const handedMore = devices.some((entry) => entry.userId === guestId && entry.taskId);
    if (handedMore || !guests.some((guest) => guest.user.id === guestId)) return;
    if (credentials)
      yield* client.machine.removeGuest(token(credentials.machineToken), guestId as RemoteUserId);
    yield* updateGuests((current) => current.filter((guest) => guest.user.id !== guestId));
  });

  const removeHandoff = Effect.fn('Remote.removeHandoff')(function* (taskId: string, guestId: string | null) {
    const handoff = (yield* file).handoffs.find((entry) => entry.taskId === taskId);
    if (handoff) yield* retireHandoff(handoff);
    const removed = (yield* file).devices.filter((entry) => entry.taskId === taskId);
    for (const entry of removed) yield* Effect.sync(() => store.removeDevice(entry.publicKey));
    const keys = new Set(removed.map((entry) => entry.publicKey));
    yield* closeChannels((device) => device !== null && keys.has(device));
    if (guestId) yield* removeGuest(guestId);
    yield* publish;
  });

  const selectLogin = Effect.fn('Remote.selectLogin')(function* (userId: string) {
    const { access: known, guests } = yield* file;
    const users = [known?.owner, ...(known?.members ?? []).map((member) => member.user)];
    const found = [...users, ...guests.map((guest) => guest.user)].find((user) => user?.id === userId);
    return found?.login ?? GUEST_FALLBACK_LOGIN;
  });

  const resolveGuest = Effect.fn('Remote.resolveGuest')(function* (device: string) {
    const enrolled = store.selectDevice(device);
    if (!enrolled?.taskId) return null;
    const guest: GuestActor = { taskId: enrolled.taskId, login: yield* selectLogin(enrolled.userId) };
    return guest;
  });

  const awaitDecision = Effect.fn('Remote.awaitDecision')(function* (requestId: string) {
    const created = yield* Deferred.make<boolean>();
    const decided = yield* Ref.modify(
      waiters,
      (current): [Deferred.Deferred<boolean>, ReadonlyMap<string, Deferred.Deferred<boolean>>] => {
        const known = current.get(requestId);
        return known ? [known, current] : [created, new Map(current).set(requestId, created)];
      }
    );
    return { kind: 'waiting', decided: Deferred.await(decided) } satisfies AccessAnswer;
  });

  const admitTeammate = Effect.fn('Remote.admitTeammate')(function* (
    proof: string,
    keys: ProofKeys,
    name: string | null,
    userId: string
  ) {
    const grant = store.selectGrant(userId);
    if (!(grant && (yield* file).access?.members.some((member) => member.user.id === userId))) return false;
    const team = store.selectTeam(grant.teamId);
    const inTeam = team?.owner.id === userId || team?.members.some((member) => member.user.id === userId);
    if (!(inTeam && store.selectTeamKey(grant.teamId) && (yield* verifyProof(grant.secret, proof, keys))))
      return false;
    const enrolledAt = yield* definition.now;
    yield* Effect.sync(() =>
      store.upsertDevice({
        publicKey: keys.device,
        name: name ?? 'Browser',
        enrolledAt,
        lastSeenAt: null,
        userId,
      })
    );
    yield* publish;
    return true;
  });

  const requestAccess = Effect.fn('Remote.requestAccess')(function* (
    proof: string,
    keys: ProofKeys,
    name: string | null,
    userId: string
  ) {
    const handoff = yield* matchHandoff(proof, keys);
    if (handoff) return yield* claimHandoff(handoff, keys.device, name, userId);
    if (!(yield* matchesLink(proof, keys))) {
      if (yield* admitTeammate(proof, keys, name, userId)) return { kind: 'admitted' } satisfies AccessAnswer;
      return {
        kind: 'refused',
        reason: 'This link was turned off. Ask for a new one.',
      } satisfies AccessAnswer;
    }
    const user = yield* resolveRequester(userId);
    if (typeof user === 'string') return { kind: 'refused', reason: user } satisfies AccessAnswer;
    const earlier = (yield* file).requests.find((entry) => entry.publicKey === keys.device);
    const request: AccessRequest = {
      id: earlier?.id ?? (yield* definition.newId),
      publicKey: keys.device,
      deviceName: name ?? earlier?.deviceName ?? 'Browser',
      user,
      requestedAt: earlier?.requestedAt ?? (yield* definition.now),
    };
    yield* update((current) => ({
      ...current,
      requests: earlier
        ? current.requests.map((entry) => (entry.id === request.id ? request : entry))
        : [...current.requests, request].slice(-MAX_REQUESTS),
    }));
    const answer: AccessAnswer = yield* awaitDecision(request.id);
    yield* publish;
    return answer;
  });

  const resumeAccess = Effect.fn('Remote.resumeAccess')(function* (device: string, userId: string) {
    const request = (yield* file).requests.find(
      (entry) => entry.publicKey === device && entry.user.id === userId
    );
    if (!request) return null;
    const answer: AccessAnswer = yield* awaitDecision(request.id);
    return answer;
  });

  const findRequest = Effect.fn('Remote.findRequest')(function* (requestId: string) {
    const request = (yield* file).requests.find((entry) => entry.id === requestId);
    if (!request)
      return yield* new DomainError({
        code: 'request_not_found',
        message: 'That access request was already handled.',
      });
    return request;
  });

  const settleRequest = Effect.fn('Remote.settleRequest')(function* (
    request: AccessRequest,
    approved: boolean
  ) {
    yield* update((current) => ({
      ...current,
      requests: current.requests.filter((entry) => entry.id !== request.id),
    }));
    const decided = yield* Ref.modify(
      waiters,
      (
        current
      ): [Deferred.Deferred<boolean> | undefined, ReadonlyMap<string, Deferred.Deferred<boolean>>] => {
        const rest = new Map(current);
        rest.delete(request.id);
        return [current.get(request.id), rest];
      }
    );
    if (decided) yield* Deferred.succeed(decided, approved);
    yield* publish;
  });

  const recordAccess = Effect.fn('Remote.recordAccess')(function* (
    next: RemoteAccess,
    guests?: RemoteMember[]
  ) {
    const before = yield* file;
    const listedGuests = guests ?? before.guests;
    const changed =
      JSON.stringify(next) !== JSON.stringify(before.access) ||
      JSON.stringify(listedGuests) !== JSON.stringify(before.guests);
    if (changed) yield* update((current) => ({ ...current, access: next, guests: listedGuests }));
    const allowed = new Set([next.owner.id, ...next.members.map((member) => member.user.id)]);
    const listed = new Set([...allowed, ...listedGuests.map((guest) => guest.user.id)]);
    const left = before.guests.map((guest) => guest.user.id).filter((id) => !listed.has(id));
    const leave = yield* Ref.get(leaver);
    if (left.length > 0 && leave) yield* Effect.sync(() => leave(left));
    const removed = new Set(yield* Effect.sync(() => store.removeDevicesOutside(allowed, listed)));
    yield* Effect.sync(() => store.removeGrantsOutside(allowed));
    yield* closeChannels((device) => device !== null && removed.has(device));
    if (changed || removed.size > 0) yield* publish;
  });

  const requestMemberAddition = Effect.fn('Remote.requestMemberAddition')(function* (
    machineToken: string,
    userId: string
  ) {
    return yield* client.machine.addMember(token(machineToken), userId as RemoteUserId).pipe(
      Effect.catchTag('MembersFull', () =>
        Effect.fail(
          new DomainError({
            code: 'members_full',
            message: `This machine has ${MAX_INSTANCE_MEMBERS} members already.`,
          })
        )
      )
    );
  });

  const grantTeammate = Effect.fn('Remote.grantTeammate')(function* (userId: string, teamId: string) {
    const credentials = yield* assertPaired;
    const known = (yield* file).access;
    const team = store.selectTeam(teamId);
    if (!(team && store.selectTeamKey(teamId)))
      return yield* new DomainError({ code: 'team_not_found', message: 'This machine is not in that team.' });
    const teammate = [team.owner, ...team.members.map((member) => member.user)].find(
      (user) => user.id === userId
    );
    if (!(known && teammate) || known.owner.id === userId)
      return yield* new DomainError({
        code: 'teammate_not_found',
        message: 'No one else in that team has that GitHub account.',
      });
    if (!known.members.some((member) => member.user.id === userId)) {
      const member = yield* requestMemberAddition(credentials.machineToken, userId);
      yield* recordAccess({ ...known, members: [...known.members, member] });
    }
    const secret = yield* definition.secret;
    yield* Effect.sync(() => store.writeGrant({ userId, teamId, secret }));
    yield* publish;
  });

  const acceptRequest = Effect.fn('Remote.acceptRequest')(function* (requestId: string) {
    const credentials = yield* assertPaired;
    const request = yield* findRequest(requestId);
    const known = (yield* file).access;
    const joins =
      known !== null &&
      known.owner.id !== request.user.id &&
      !known.members.some((member) => member.user.id === request.user.id);
    if (joins) {
      const member = yield* requestMemberAddition(credentials.machineToken, request.user.id);
      yield* recordAccess({ ...known, members: [...known.members, member] });
    }
    const enrolledAt = yield* definition.now;
    yield* Effect.sync(() =>
      store.upsertDevice({
        publicKey: request.publicKey,
        name: request.deviceName,
        enrolledAt,
        lastSeenAt: null,
        userId: request.user.id,
      })
    );
    yield* settleRequest(request, true);
  });

  const declineRequest = Effect.fn('Remote.declineRequest')(function* (requestId: string) {
    yield* settleRequest(yield* findRequest(requestId), false);
  });

  const removeMember = Effect.fn('Remote.removeMember')(function* (userId: string) {
    const credentials = yield* assertPaired;
    const known = (yield* file).access;
    if (!known?.members.some((member) => member.user.id === userId))
      return yield* new DomainError({
        code: 'member_not_found',
        message: 'No member with that GitHub account has access to this machine.',
      });
    yield* client.machine.removeMember(token(credentials.machineToken), userId as RemoteUserId);
    yield* recordAccess({ ...known, members: known.members.filter((member) => member.user.id !== userId) });
  });

  const admits = (device: string, userId: string) =>
    Effect.sync(() => store.selectDevice(device)?.userId === userId);

  const recordSeen = Effect.fn('Remote.recordSeen')(function* (device: string) {
    const at = yield* definition.now;
    yield* Effect.sync(() => store.recordDeviceSeen(device, at));
  });

  const recordTeams = Effect.fn('Remote.recordTeams')(function* (teams: RemoteTeam[]) {
    if (yield* Effect.sync(() => store.recordTeams(teams))) yield* publish;
  });

  const recordStatus = Effect.fn('Remote.recordStatus')(function* (status: TunnelStatus) {
    yield* Ref.set(tunnelStatus, status);
    yield* publish;
  });

  const forget = Effect.gen(function* () {
    yield* update((current) => ({
      ...current,
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
    yield* access.end;
    yield* publish;
  }).pipe(Effect.withSpan('Remote.forget'));

  const verifyConnect = Effect.fn('Remote.verifyConnect')(function* (
    connectToken: string | null,
    channel: ConnectChannel
  ) {
    const { credentials } = yield* file;
    if (!(connectToken && credentials && (yield* isEnabled))) return null;
    const audience = { instanceId: credentials.instanceId, channel };
    const now = yield* definition.now;
    return yield* Effect.promise(() =>
      verifyConnectToken(credentials.connectKey, connectToken, audience, now)
    );
  });

  const spendConnect = Effect.fn('Remote.spendConnect')(function* (claim: ConnectClaim) {
    const now = yield* definition.now;
    return yield* Ref.modify(spentConnects, (current): [boolean, ReadonlyMap<string, number>] => {
      const live = new Map([...current].filter(([, expiresAt]) => expiresAt > now));
      if (claim.expiresAt <= now || live.has(claim.nonce)) return [false, live];
      return [true, live.set(claim.nonce, claim.expiresAt)];
    });
  });

  const trackChannel = Effect.fn('Remote.trackChannel')(function* (channel: RemoteChannelHandle) {
    const release = yield* access.acquire(
      Effect.gen(function* () {
        if (yield* releaseChannel(channel)) yield* channel.fail(REMOTE_ACCESS_CHANGED);
      })
    );
    yield* Ref.update(channels, (current) => new Map(current).set(channel, release));
  });

  const closeChannel = Effect.fn('Remote.closeChannel')(function* (channel: RemoteChannelHandle) {
    yield* channel.close;
    const release = (yield* Ref.get(channels)).get(channel);
    yield* releaseChannel(channel);
    if (release) yield* release;
  });

  const removeDevice = Effect.fn('Remote.removeDevice')(function* (publicKey: string) {
    const removed = yield* Effect.sync(() => store.removeDevice(publicKey));
    yield* closeChannels((device) => device === publicKey);
    yield* publish;
    return removed;
  });

  return {
    snapshot,
    isEnabled,
    tunnelHost,
    guestRevision: Ref.get(guestRevision),
    signingKey: definition.signingKey,
    startPairing,
    cancelPairing,
    resolveHookUrl,
    enable,
    disable,
    remove,
    createLink,
    removeLink,
    handleClaims,
    handleLeaves,
    createHandoff,
    removeHandoff,
    requestAccess,
    resumeAccess,
    admits,
    resolveGuest,
    recordSeen,
    grantTeammate,
    acceptRequest,
    declineRequest,
    removeMember,
    recordAccess,
    recordTeams,
    recordStatus,
    forget,
    publish,
    subscribe,
    start,
    stop,
    verifyConnect,
    spendConnect,
    trackChannel,
    closeChannel,
    removeDevice,
  };
});
