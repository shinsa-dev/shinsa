import { randomBytes, randomUUID } from 'node:crypto';
import {
  type AccessRequest,
  type ConnectChannel,
  type ConnectClaim,
  DomainError,
  type ScopedActor,
  type HeartbeatRequest,
  hasScope,
  isTeamPerson,
  MACHINE_FEATURES,
  mergeScopes,
  MAX_INSTANCE_GUESTS,
  MAX_INSTANCE_MEMBERS,
  type PairingView,
  type RemoteAccess,
  type RemoteMember,
  type RemoteSnapshot,
  type RemoteDevice,
  type RemoteTeam,
  type RemoteUser,
  type RemoteUserId,
  type TunnelStatus,
  resolveClaimUrl,
  resolveEnrollUrl,
  resolveMemberScopes,
  resolveRemoteHookUrl,
  serializeBase64Url,
  verifyConnectToken,
  verifyEnrollProof,
} from '@shinsa/core';
import { Clock, Context, Deferred, Effect, Exit, Fiber, Layer, Redacted, Ref } from 'effect';
import { describeError } from '../../log/redact.ts';
import { AccessScope } from '../access/service.ts';
import {
  type AccessAnswer,
  ChannelBroken,
  type ChannelPeer,
  type ProofKeys,
  type RemoteChannelHandle,
} from '../channel/schema.ts';
import { makeRemoteChannel } from '../channel/service.ts';
import { RemoteOrigin } from '../client/schema.ts';
import { RemoteClient } from '../client/service.ts';
import { TunnelConnector } from '../connector/service.ts';
import { TunnelHealth } from '../health/service.ts';
import { RemoteUrlOpener } from '../opener/service.ts';
import type { PairedMachine, PairingEnd } from '../pairing/schema.ts';
import { Pairings } from '../pairing/service.ts';
import { listTeamEntries } from '../store/derive.ts';
import type { RemoteFile, StoredHandoff, StoredLink } from '../store/schema.ts';
import { RemoteStore } from '../store/service.ts';
import { TunnelMachine } from '../tunnel/schema.ts';
import { TunnelSupervisor } from '../tunnel/service.ts';
import {
  type ChannelParts,
  UNKNOWN_PERSON,
  type GuestLeaver,
  type HandoffClaim,
  HANDOFF_NOT_ENABLED,
  HANDOFF_UNAVAILABLE,
  MAX_REQUESTS,
  REMOTE_ACCESS_CHANGED,
  type RemoteHandle,
  type RemoteInput,
  RemoteKeyUnreadable,
  SECRET_BYTES,
  NOWHERE,
  type TeamScope,
} from './schema.ts';

export class Remote extends Context.Service<Remote, RemoteHandle>()('shinsa/engine/remote/machine/Remote') {
  static readonly layer = (input: RemoteInput) =>
    Layer.effect(
      Remote,
      Effect.gen(function* () {
        const client = yield* RemoteClient;
        const pairings = yield* Pairings;
        const store = yield* RemoteStore;
        const access = yield* AccessScope;
        const origin = yield* RemoteOrigin;
        const opener = yield* RemoteUrlOpener;
        const connector = yield* TunnelConnector;
        const health = yield* TunnelHealth;
        const tunnelStatus = yield* Ref.make<TunnelStatus>('off');
        const pairing = yield* Ref.make<{ view: PairingView; fiber: Fiber.Fiber<PairingEnd> } | null>(null);
        const claimer = yield* Ref.make<HandoffClaim | null>(null);
        const leaver = yield* Ref.make<GuestLeaver | null>(null);
        const guestRevision = yield* Ref.make(0);
        const channels = yield* Ref.make<ReadonlyMap<RemoteChannelHandle, Effect.Effect<void>>>(new Map());
        const spentConnects = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
        const listeners = new Set<Effect.Effect<void>>();
        const teamScopes = new Map<string, string>();
        const waiters = yield* Ref.make<ReadonlyMap<string, Deferred.Deferred<boolean>>>(new Map());

        const file = store.file;

        const createSecret = Effect.sync(() => serializeBase64Url(new Uint8Array(randomBytes(SECRET_BYTES))));

        const newId = Effect.sync(randomUUID);

        const toKeyFailure = (error: unknown) => new RemoteKeyUnreadable({ message: describeError(error) });

        const machineKey = store.resolveMachineKey.pipe(Effect.mapError(toKeyFailure));

        const token = (machineToken: string) => Redacted.make(machineToken);

        const isEnabled = file.pipe(Effect.map((current) => current.enabled && current.credentials !== null));

        const tunnelHost = file.pipe(Effect.map((current) => current.credentials?.tunnelHost ?? null));

        const publish = Effect.suspend(() =>
          syncTeamAccess.pipe(
            Effect.andThen(Effect.forEach([...listeners], (listener) => listener, { discard: true }))
          )
        );

        const observe = (listener: Effect.Effect<void>) =>
          Effect.acquireRelease(
            Effect.sync(() => listeners.add(listener)),
            () => Effect.sync(() => listeners.delete(listener))
          ).pipe(Effect.asVoid);

        const serializeLink = Effect.fn('Remote.serializeLink')(function* (link: StoredLink) {
          const { credentials, machine } = yield* file;
          const fragment = {
            instanceId: credentials?.instanceId ?? '',
            machineKey: machine?.publicKey ?? '',
            secret: link.secret,
            invite: link.invite,
          };
          return { url: resolveEnrollUrl(fragment, origin), createdAt: link.createdAt };
        });

        const snapshot = Effect.gen(function* () {
          const current = yield* file;
          const view: RemoteSnapshot = {
            paired: current.credentials !== null,
            enabled: yield* isEnabled,
            status: yield* Ref.get(tunnelStatus),
            instanceId: current.credentials?.instanceId ?? null,
            owner: current.owner,
            machineName: input.machineName,
            machineKey: current.machine?.publicKey ?? null,
            pairing: (yield* Ref.get(pairing))?.view ?? null,
            devices: current.devices,
            access: current.access,
            link:
              current.credentials && current.machine && current.link
                ? yield* serializeLink(current.link)
                : null,
            requests: current.requests,
            teams: listTeamEntries(current),
          };
          return view;
        }).pipe(Effect.withSpan('Remote.snapshot'));

        const assertPaired = Effect.gen(function* () {
          const { credentials } = yield* file;
          if (!credentials)
            return yield* new DomainError({
              code: 'remote_not_paired',
              message: 'Turn on remote access first.',
            });
          return credentials;
        });

        const update = (change: (current: RemoteFile) => RemoteFile) => Effect.orDie(store.update(change));

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
            return yield* new DomainError({
              code: 'remote_paired',
              message: 'This machine is already paired.',
            });
          const existing = yield* Ref.get(pairing);
          if (existing) return existing.view;
          const machine = yield* machineKey;
          const started = yield* client.pairing.start({
            name: input.machineName,
            publicKey: machine.publicKey,
            version: input.version,
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
              if (Exit.isSuccess(exit) && exit.value.status === 'claimed')
                yield* recordPaired(exit.value.machine);
              yield* publish;
            })
          );
          yield* opener
            .open(started.url)
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
          return resolveRemoteHookUrl(credentials.instanceId, scheduleId, hookToken, origin);
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
          yield* machineKey;
          const { token: invite } = yield* client.machine.createInvite(token(credentials.machineToken));
          const link: StoredLink = {
            secret: yield* createSecret,
            invite,
            createdAt: yield* Clock.currentTimeMillis,
          };
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
          return link !== null && (yield* verifyEnrollProof(link.secret, proof, keys));
        });

        const matchHandoff = Effect.fn('Remote.matchHandoff')(function* (proof: string, keys: ProofKeys) {
          for (const handoff of (yield* file).handoffs) {
            if (yield* verifyEnrollProof(handoff.secret, proof, keys)) return handoff;
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
          return resolveClaimUrl(fragment, origin);
        });

        const createHandoff = Effect.fn('Remote.createHandoff')(function* (taskId: string) {
          const { credentials, handoffs } = yield* file;
          if (!(credentials && (yield* isEnabled)))
            return yield* new DomainError({ code: 'remote_not_enabled', message: HANDOFF_NOT_ENABLED });
          const existing = handoffs.find((entry) => entry.taskId === taskId);
          if (existing) return yield* resolveHandoffUrl(existing);
          yield* machineKey;
          const { token: invite } = yield* client.machine.createHandoff(token(credentials.machineToken));
          const handoff: StoredHandoff = {
            taskId,
            secret: yield* createSecret,
            invite,
            createdAt: yield* Clock.currentTimeMillis,
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

        const isOwner = Effect.fn('Remote.isOwner')(function* (userId: string | null) {
          return userId !== null && (yield* file).access?.owner.id === userId;
        });

        const resolveActor = Effect.fn('Remote.resolveActor')(function* (userId: string | null) {
          const known = (yield* file).access;
          if (!known) return null;
          const people = [known.owner, ...known.members.map((member) => member.user)];
          const person = userId === null ? known.owner : people.find((user) => user.id === userId);
          return person ? { login: person.login, name: person.name, avatarUrl: person.avatarUrl } : null;
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
          const enrolledAt = yield* Clock.currentTimeMillis;
          yield* Effect.orDie(
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

        const removeHandoff = Effect.fn('Remote.removeHandoff')(function* (
          taskId: string,
          guestId: string | null
        ) {
          const handoff = (yield* file).handoffs.find((entry) => entry.taskId === taskId);
          if (handoff) yield* retireHandoff(handoff);
          const removed = (yield* file).devices.filter((entry) => entry.taskId === taskId);
          for (const entry of removed) yield* Effect.orDie(store.removeDevice(entry.publicKey));
          const keys = new Set(removed.map((entry) => entry.publicKey));
          yield* closeChannels((device) => device !== null && keys.has(device));
          if (guestId) yield* removeGuest(guestId);
          yield* publish;
        });

        const selectPerson = Effect.fn('Remote.selectPerson')(function* (userId: string) {
          const { access: known, guests, teams } = yield* file;
          const users = [known?.owner, ...(known?.members ?? []).map((member) => member.user)];
          const teammates = teams.flatMap((team) => [
            team.owner,
            ...team.members.map((member) => member.user),
          ]);
          const found = [...users, ...guests.map((guest) => guest.user), ...teammates].find(
            (user) => user?.id === userId
          );
          const person: RemoteUser = found ?? { ...UNKNOWN_PERSON, id: userId };
          return person;
        });

        const selectTeamAccess = Effect.fn('Remote.selectTeamAccess')(function* (
          userId: string,
          teamId: string
        ) {
          const team = yield* store.selectTeam(teamId);
          if (!team || !(yield* store.selectTeamKey(teamId))) return null;
          if (yield* isOwner(userId)) return null;
          return isTeamPerson(team, userId) ? team : null;
        });

        const resolveTeamScope = Effect.fn('Remote.resolveTeamScope')(function* (
          userId: string,
          teamId: string
        ) {
          const team = yield* selectTeamAccess(userId, teamId);
          if (!team) return null;
          const extra = (yield* store.selectExtra(userId, team.id))?.scopes ?? [];
          const scope: TeamScope = {
            kind: 'team',
            teamId: team.id,
            scopes: mergeScopes(resolveMemberScopes(team, userId), extra),
          };
          return scope;
        });

        const listTeamScopes = Effect.fn('Remote.listTeamScopes')(function* (userId: string) {
          const scopes = yield* Effect.forEach((yield* file).teams, (team) =>
            resolveTeamScope(userId, team.id)
          );
          return scopes.flatMap((scope) => (scope ? [scope] : []));
        });

        const canForkTeamTask = Effect.fn('Remote.canForkTeamTask')(function* ({
          teamId,
        }: {
          readonly teamId: string;
        }) {
          const current = yield* file;
          const ownerId = current.access?.owner.id;
          const team = current.teams.find((entry) => entry.id === teamId);
          return Boolean(ownerId && team && hasScope(resolveMemberScopes(team, ownerId), 'fork'));
        });

        const resolveScope = Effect.fn('Remote.resolveScope')(function* (enrolled: RemoteDevice) {
          if (enrolled.taskId) {
            const scope: ScopedActor['scope'] = { kind: 'task', taskId: enrolled.taskId };
            return scope;
          }
          if (!enrolled.teamId || (yield* hasAccess(enrolled.userId))) return null;
          const scope: ScopedActor['scope'] =
            (yield* resolveTeamScope(enrolled.userId, enrolled.teamId)) ?? NOWHERE;
          return scope;
        });

        const resolveGuest = Effect.fn('Remote.resolveGuest')(function* (device: string) {
          const enrolled = yield* store.selectDevice(device);
          const scope = enrolled ? yield* resolveScope(enrolled) : null;
          if (!(enrolled && scope)) return null;
          if (scope.kind === 'team') teamScopes.set(device, JSON.stringify(scope));
          const { id, login, name, avatarUrl } = yield* selectPerson(enrolled.userId);
          const guest: ScopedActor = { id, login, name, avatarUrl, scope };
          return guest;
        });

        const resolveTeamGrant = Effect.fn('Remote.resolveTeamGrant')(function* (
          userId: string,
          teamId: string
        ) {
          if (!((yield* isEnabled) && (yield* selectTeamAccess(userId, teamId)))) return null;
          const existing = yield* store.selectGrant(userId, teamId);
          if (existing) return existing.secret;
          const secret = yield* createSecret;
          yield* Effect.orDie(store.writeGrant({ userId, teamId, secret }));
          return secret;
        });

        const listOutsidePairs = Effect.gen(function* () {
          const current = yield* file;
          const outside = new Set<string>();
          for (const pair of [...current.grants, ...current.extras, ...current.devices]) {
            const teamId = pair.teamId;
            if (teamId && !(yield* selectTeamAccess(pair.userId, teamId)))
              outside.add(`${pair.userId}:${teamId}`);
          }
          return outside;
        });

        const removeOutside = Effect.fn('Remote.removeOutside')(function* (outside: ReadonlySet<string>) {
          const isOutside = (userId: string, teamId: string) => outside.has(`${userId}:${teamId}`);
          yield* Effect.orDie(store.removeGrantsWhere((grant) => isOutside(grant.userId, grant.teamId)));
          yield* Effect.orDie(store.removeExtrasWhere((extra) => isOutside(extra.userId, extra.teamId)));
          const removed = yield* Effect.orDie(
            store.removeDevicesWhere(
              (device) => device.teamId != null && isOutside(device.userId, device.teamId)
            )
          );
          return new Set(removed);
        });

        const listNarrowed = Effect.gen(function* () {
          const narrowed = new Set<string>();
          for (const [device, opened] of teamScopes) {
            const enrolled = yield* store.selectDevice(device);
            const scope = enrolled ? yield* resolveScope(enrolled) : null;
            if (JSON.stringify(scope) !== opened) narrowed.add(device);
          }
          return narrowed;
        });

        const syncTeamAccess = Effect.gen(function* () {
          const removed = yield* removeOutside(yield* listOutsidePairs);
          const narrowed = yield* listNarrowed;
          const ended = new Set([...removed, ...narrowed]);
          for (const device of ended) teamScopes.delete(device);
          if (ended.size === 0) return;
          yield* closeChannels((device) => device !== null && ended.has(device));
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

        const matchGrant = Effect.fn('Remote.matchGrant')(function* (
          userId: string,
          proof: string,
          keys: ProofKeys
        ) {
          for (const grant of yield* store.listGrants(userId)) {
            if (!(yield* selectTeamAccess(userId, grant.teamId))) continue;
            if (yield* verifyEnrollProof(grant.secret, proof, keys)) return grant;
          }
          return null;
        });

        const admitTeammate = Effect.fn('Remote.admitTeammate')(function* (
          proof: string,
          keys: ProofKeys,
          name: string | null,
          userId: string
        ) {
          const grant = yield* matchGrant(userId, proof, keys);
          if (!grant) return false;
          const enrolledAt = yield* Clock.currentTimeMillis;
          const full = yield* hasAccess(userId);
          yield* Effect.orDie(
            store.upsertDevice({
              publicKey: keys.device,
              name: name ?? 'Browser',
              enrolledAt,
              lastSeenAt: null,
              userId,
              ...(full ? {} : { teamId: grant.teamId }),
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
            if (yield* admitTeammate(proof, keys, name, userId))
              return { kind: 'admitted' } satisfies AccessAnswer;
            return {
              kind: 'refused',
              reason: 'This link was turned off. Ask for a new one.',
            } satisfies AccessAnswer;
          }
          const user = yield* resolveRequester(userId);
          if (typeof user === 'string') return { kind: 'refused', reason: user } satisfies AccessAnswer;
          const earlier = (yield* file).requests.find((entry) => entry.publicKey === keys.device);
          const request: AccessRequest = {
            id: earlier?.id ?? (yield* newId),
            publicKey: keys.device,
            deviceName: name ?? earlier?.deviceName ?? 'Browser',
            user,
            requestedAt: earlier?.requestedAt ?? (yield* Clock.currentTimeMillis),
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
          if (left.length > 0 && leave) yield* leave(left);
          const removed = new Set(yield* Effect.orDie(store.removeDevicesOutside(allowed, listed)));
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
          const team = yield* store.selectTeam(teamId);
          if (!(team && (yield* store.selectTeamKey(teamId))))
            return yield* new DomainError({
              code: 'team_not_found',
              message: 'This machine is not in that team.',
            });
          if (!(known && (yield* selectTeamAccess(userId, teamId))))
            return yield* new DomainError({
              code: 'teammate_not_found',
              message: 'No one else in that team has that GitHub account.',
            });
          if (!known.members.some((member) => member.user.id === userId)) {
            const member = yield* requestMemberAddition(credentials.machineToken, userId);
            yield* recordAccess({ ...known, members: [...known.members, member] });
          }
          yield* resolveTeamGrant(userId, teamId);
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
          const enrolledAt = yield* Clock.currentTimeMillis;
          yield* Effect.orDie(
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
          yield* recordAccess({
            ...known,
            members: known.members.filter((member) => member.user.id !== userId),
          });
        });

        const admits = Effect.fn('Remote.admits')(function* (device: string, userId: string) {
          const enrolled = yield* store.selectDevice(device);
          if (enrolled?.userId !== userId) return false;
          return !enrolled.teamId || (yield* resolveScope(enrolled)) !== NOWHERE;
        });

        const recordSeen = Effect.fn('Remote.recordSeen')(function* (device: string) {
          yield* Effect.orDie(store.recordDeviceSeen(device, yield* Clock.currentTimeMillis));
        });

        const recordTeams = Effect.fn('Remote.recordTeams')(function* (teams: RemoteTeam[]) {
          if (yield* Effect.orDie(store.recordTeams(teams))) yield* publish;
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
          const at = yield* Clock.currentTimeMillis;
          return yield* verifyConnectToken(credentials.connectKey, connectToken, audience, at);
        });

        const spendConnect = Effect.fn('Remote.spendConnect')(function* (claim: ConnectClaim) {
          const at = yield* Clock.currentTimeMillis;
          return yield* Ref.modify(spentConnects, (current): [boolean, ReadonlyMap<string, number>] => {
            const live = new Map([...current].filter(([, expiresAt]) => expiresAt > at));
            if (claim.expiresAt <= at || live.has(claim.nonce)) return [false, live];
            return [true, live.set(claim.nonce, claim.expiresAt)];
          });
        });

        const trackChannel = Effect.fn('Remote.trackChannel')(function* (channel: RemoteChannelHandle) {
          const lease = yield* access.acquire(
            Effect.gen(function* () {
              if (yield* releaseChannel(channel)) yield* channel.fail(REMOTE_ACCESS_CHANGED);
            })
          );
          yield* Ref.update(channels, (current) => new Map(current).set(channel, lease.release));
        });

        const closeChannel = Effect.fn('Remote.closeChannel')(function* (channel: RemoteChannelHandle) {
          yield* channel.close;
          const release = (yield* Ref.get(channels)).get(channel);
          yield* releaseChannel(channel);
          if (release) yield* release;
        });

        const removeDevice = Effect.fn('Remote.removeDevice')(function* (publicKey: string) {
          const removed = yield* Effect.orDie(store.removeDevice(publicKey));
          yield* closeChannels((device) => device === publicKey);
          yield* publish;
          return removed;
        });

        const toBroken = (error: unknown) => new ChannelBroken({ message: describeError(error) });

        const openChannel = Effect.fn('Remote.openChannel')(function* (
          peer: ChannelPeer,
          parts: ChannelParts,
          userId: string
        ) {
          const channel = yield* makeRemoteChannel({
            send: (data) => Effect.sync(() => peer.send(data)),
            buffered: peer.buffered,
            closePeer: (code, reason) => Effect.sync(() => peer.close(code, reason)),
            machineKey: store.resolveMachineKey.pipe(Effect.mapError(toBroken)),
            isEnrolled: (device) => admits(device, userId),
            resolveGuest,
            isOwner: isOwner(userId),
            userId,
            requestAccess: (proof, keys, name) =>
              requestAccess(proof, keys, name, userId).pipe(Effect.mapError(toBroken)),
            resumeAccess: (device) => resumeAccess(device, userId),
            recordSeen,
            openSocket: (socket) => Effect.sync(() => parts.hub.open(socket)),
            closeSocket: (socket) => Effect.sync(() => parts.hub.close(socket)),
            receiveSocket: (socket, raw) => Effect.sync(() => parts.hub.message(socket, raw)),
            terminals: parts.terminals,
            respond: (request, guest) => parts.respond(request, guest, userId),
            maxBodyBytes: input.maxBodyBytes,
          });
          yield* trackChannel(channel);
          return channel;
        });

        const tunnel = Context.get(
          yield* Layer.build(
            TunnelSupervisor.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(TunnelMachine, {
                    version: input.version,
                    localUrl: input.localUrl,
                    signingKey: store.resolveSigningKey.pipe(
                      Effect.map((key) => key.publicKey),
                      Effect.catch((error) =>
                        Effect.logWarning('[Remote] Could not read the signing key').pipe(
                          Effect.annotateLogs({ error: describeError(error) }),
                          Effect.as(null)
                        )
                      )
                    ),
                    heartbeat: Effect.fn('Remote.heartbeat')(function* (
                      machineToken: Redacted.Redacted<string>,
                      request: HeartbeatRequest
                    ) {
                      const revision = yield* Ref.get(guestRevision);
                      const answer = yield* client.machine.heartbeat(machineToken, request);
                      if (revision === (yield* Ref.get(guestRevision))) return answer;
                      return { ...answer, guests: (yield* file).guests };
                    }),
                    recordAccess: (known, guests) => recordAccess(known, guests),
                    recordTeams,
                    recordStatus,
                    forget,
                  }),
                  Layer.succeed(TunnelConnector, connector),
                  Layer.succeed(TunnelHealth, health),
                  Layer.succeed(RemoteClient, client)
                )
              )
            )
          ),
          TunnelSupervisor
        );

        return Remote.of({
          machineName: input.machineName,
          snapshot,
          isEnabled,
          tunnelHost,
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
          grantTeammate,
          acceptRequest,
          declineRequest,
          removeMember,
          publish,
          observe,
          start,
          stop,
          requestHeartbeat: tunnel.heartbeat,
          verifyConnect,
          spendConnect,
          isOwner,
          hasAccess,
          resolveActor,
          resolveTeamScope,
          listTeamScopes,
          resolveTeamGrant,
          canForkTeamTask,
          openChannel,
          closeChannel,
          removeDevice,
        });
      })
    );
}
