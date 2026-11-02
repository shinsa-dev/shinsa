import {
  type InstanceId,
  MAX_INSTANCE_GUESTS,
  MAX_INSTANCE_MEMBERS,
  type RemoteMember,
  type RemoteUserId,
  resolveTunnelHost,
} from '@shinsa/core';
import { CurrentMachine, CurrentUser, RemoteApi } from '@shinsa/core/remote/api';
import {
  GuestsFull,
  HandoffInvalid,
  InviteInvalid,
  MembersFull,
  NotFound,
  OwnerCannotLeave,
  Revoked,
} from '@shinsa/core/remote/errors';
import { Clock, Effect, Option, Redacted } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { findMachineAccess, findOwnMachine } from '../auth/access.ts';
import { CloudCrypto, type TokenHash } from '../crypto/crypto.ts';
import { appendResponseHeader, NOINDEX } from '../http/responses.ts';
import { Cloudflare } from '../integrations/cloudflare.ts';
import { MachineAccess } from '../store/access.ts';
import { Accounts } from '../store/accounts.ts';
import { type Machine, Machines } from '../store/machines.ts';
import type { Membership } from '../store/tables.ts';
import { Teams } from '../store/teams.ts';
import {
  createConnectAnswer,
  findMachineOwner,
  isMachineOnline,
  listMachinePeople,
  resolveTunnelUrl,
  serializeInstance,
} from '../views/machines.ts';
import { listUserTeams } from '../views/teams.ts';

const removeMachine = Effect.fn('removeMachine')(function* (machine: Machine) {
  const cloudflare = yield* Cloudflare;
  const machines = yield* Machines;
  yield* cloudflare.removeTunnel(machine.tunnelId, machine.dnsRecordId);
  yield* machines.remove(machine.id);
});

const answerAccept = Effect.fn('answerAccept')(function* (machine: Machine, user: CurrentUser['Service']) {
  const access = yield* MachineAccess;
  yield* access.requesters.add(machine.id, user.id);
  return {
    instanceId: machine.id,
    name: machine.name,
    owner: yield* findMachineOwner(machine),
    user,
    connect: yield* createConnectAnswer(machine, user.id),
  };
});

const selectTokenMachine = Effect.fn('selectTokenMachine')(function* (
  select: (tokenHash: TokenHash) => Effect.Effect<Option.Option<InstanceId>>,
  token: string
) {
  const crypto = yield* CloudCrypto;
  const machines = yield* Machines;
  const instanceId = yield* select(yield* crypto.hashToken(Redacted.make(token)));
  return Option.isSome(instanceId) ? yield* machines.select(instanceId.value) : Option.none<Machine>();
});

export const InstancesHandlers = HttpApiBuilder.group(
  RemoteApi,
  'instances',
  Effect.fn(function* (handlers) {
    const machines = yield* Machines;
    const access = yield* MachineAccess;

    return handlers
      .handle('list', () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const now = yield* Clock.currentTimeMillis;
          return (yield* machines.listOfUser(user.id)).map((shared) => serializeInstance(shared, now));
        })
      )
      .handle('connect', ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const { machine } = yield* findMachineAccess(user.id, params.instanceId);
          return yield* createConnectAnswer(machine, user.id);
        })
      )
      .handle('remove', ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          yield* removeMachine(yield* findOwnMachine(user.id, params.instanceId));
          return { ok: true as const };
        })
      )
      .handle('leave', ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const { machine, role } = yield* findMachineAccess(user.id, params.instanceId);
          if (role === 'owner')
            return yield* new OwnerCannotLeave({ message: 'You own this machine. Remove it instead.' });
          const membership = role === 'member' ? access.members : access.guests;
          yield* membership.remove(machine.id, user.id);
          return { ok: true as const };
        })
      )
      .handle('inviteAccept', ({ payload }) =>
        Effect.gen(function* () {
          const machine = yield* selectTokenMachine(access.invites.select, payload.token);
          if (Option.isNone(machine))
            return yield* new InviteInvalid({
              message: 'This invite link was turned off. Ask the machine’s owner for a new one.',
            });
          return yield* answerAccept(machine.value, yield* CurrentUser);
        })
      )
      .handle('handoffAccept', ({ payload }) =>
        Effect.gen(function* () {
          const machine = yield* selectTokenMachine(access.handoffs.select, payload.token);
          if (Option.isNone(machine))
            return yield* new HandoffInvalid({
              message:
                'This hand-off link was taken back or already used. Ask the task’s owner for a new one.',
            });
          return yield* answerAccept(machine.value, yield* CurrentUser);
        })
      );
  })
);

export const SharesHandlers = HttpApiBuilder.group(
  RemoteApi,
  'shares',
  Effect.fn(function* (handlers) {
    const machines = yield* Machines;

    return handlers.handle('connect', ({ params }) =>
      Effect.gen(function* () {
        yield* appendResponseHeader('x-robots-tag', NOINDEX);
        const machine = yield* machines.select(params.instanceId);
        if (Option.isNone(machine))
          return yield* new NotFound({ message: 'This task is no longer shared, or the link is wrong.' });
        return {
          url: resolveTunnelUrl(machine.value),
          online: isMachineOnline(machine.value, yield* Clock.currentTimeMillis),
        };
      })
    );
  })
);

const findCurrentMachine = Effect.gen(function* () {
  const machines = yield* Machines;
  const { instanceId } = yield* CurrentMachine;
  const machine = yield* machines.select(instanceId);
  if (Option.isNone(machine)) return yield* new Revoked({ message: 'This machine is not paired.' });
  return machine.value;
});

const NOT_ASKED = 'No one with that account asked to reach this machine or is in a team with you.';

const hasAsked = Effect.fn('hasAsked')(function* (userId: RemoteUserId) {
  const { instanceId, ownerId } = yield* CurrentMachine;
  const access = yield* MachineAccess;
  const teams = yield* Teams;
  if (ownerId === userId) return true;
  if (yield* access.members.has(instanceId, userId)) return true;
  if (yield* access.requesters.has(instanceId, userId)) return true;
  return yield* teams.shareTeam(ownerId, userId);
});

const findAskingUser = Effect.fn('findAskingUser')(function* (userId: RemoteUserId, isGuestToo = false) {
  const { instanceId } = yield* CurrentMachine;
  const access = yield* MachineAccess;
  const accounts = yield* Accounts;
  const asked = (isGuestToo && (yield* access.guests.has(instanceId, userId))) || (yield* hasAsked(userId));
  const user = asked ? yield* accounts.selectUser(userId) : Option.none();
  if (Option.isNone(user)) return yield* new NotFound({ message: NOT_ASKED });
  return user.value;
});

export const MachineHandlers = HttpApiBuilder.group(
  RemoteApi,
  'machine',
  Effect.fn(function* (handlers) {
    const machines = yield* Machines;
    const access = yield* MachineAccess;
    const crypto = yield* CloudCrypto;
    const cloudflare = yield* Cloudflare;

    const createLink = Effect.fn('machine.createLink')(function* (
      record: (instanceId: InstanceId, tokenHash: TokenHash) => Effect.Effect<void>
    ) {
      const { instanceId } = yield* CurrentMachine;
      const token = yield* crypto.createToken();
      yield* record(instanceId, yield* crypto.hashToken(token));
      return { token: Redacted.value(token) };
    });

    const addPerson = Effect.fn('machine.addPerson')(function* <Full extends MembersFull | GuestsFull>(
      userId: RemoteUserId,
      slot: { readonly membership: Membership<InstanceId>; readonly limit: number; readonly full: Full }
    ) {
      const { instanceId, ownerId } = yield* CurrentMachine;
      const user = yield* findAskingUser(userId, slot.membership === access.guests);
      const now = yield* Clock.currentTimeMillis;
      const reaches = ownerId === userId || (yield* access.members.has(instanceId, userId));
      if (!reaches && !(yield* slot.membership.has(instanceId, userId))) {
        if ((yield* slot.membership.count(instanceId)) >= slot.limit) return yield* Effect.fail(slot.full);
        yield* slot.membership.add(instanceId, userId);
      }
      yield* access.requesters.remove(instanceId, userId);
      return { user, addedAt: now } satisfies RemoteMember;
    });

    const memberSlot = {
      membership: access.members,
      limit: MAX_INSTANCE_MEMBERS,
      full: new MembersFull({
        message: `This machine already has ${MAX_INSTANCE_MEMBERS} members. Remove one first.`,
      }),
    };

    const guestSlot = {
      membership: access.guests,
      limit: MAX_INSTANCE_GUESTS,
      full: new GuestsFull({
        message: `This machine already has ${MAX_INSTANCE_GUESTS} people working on its tasks. Remove one first.`,
      }),
    };

    const ok = { ok: true as const };

    return handlers
      .handle('heartbeat', ({ payload }) =>
        Effect.gen(function* () {
          const machine = yield* findCurrentMachine;
          if (payload.localUrl !== machine.localUrl)
            yield* cloudflare.updateIngress(
              machine.tunnelId,
              resolveTunnelHost(machine.id),
              payload.localUrl
            );
          yield* machines.recordHeartbeat(machine.id, payload.localUrl, payload.signingKey ?? null);
          const { owner, members, guests } = yield* listMachinePeople(machine);
          return { ok: true as const, owner, members, guests, teams: yield* listUserTeams(machine.userId) };
        })
      )
      .handle('offline', () =>
        Effect.gen(function* () {
          yield* machines.recordOffline((yield* CurrentMachine).instanceId);
          return ok;
        })
      )
      .handle('remove', () =>
        Effect.gen(function* () {
          yield* removeMachine(yield* findCurrentMachine);
          return ok;
        })
      )
      .handle('inviteCreate', () => createLink(access.invites.replace))
      .handle('inviteRemove', () =>
        Effect.gen(function* () {
          yield* access.invites.remove((yield* CurrentMachine).instanceId);
          return ok;
        })
      )
      .handle('requesterFind', ({ payload }) => findAskingUser(payload.userId))
      .handle('memberAdd', ({ payload }) => addPerson(payload.userId, memberSlot))
      .handle('memberRemove', ({ payload }) =>
        Effect.gen(function* () {
          yield* access.members.remove((yield* CurrentMachine).instanceId, payload.userId);
          return ok;
        })
      )
      .handle('handoffCreate', () => createLink(access.handoffs.create))
      .handle('handoffRemove', ({ payload }) =>
        Effect.gen(function* () {
          const { instanceId } = yield* CurrentMachine;
          yield* access.handoffs.remove(instanceId, yield* crypto.hashToken(Redacted.make(payload.token)));
          return ok;
        })
      )
      .handle('guestAdd', ({ payload }) => addPerson(payload.userId, guestSlot))
      .handle('guestRemove', ({ payload }) =>
        Effect.gen(function* () {
          yield* access.guests.remove((yield* CurrentMachine).instanceId, payload.userId);
          return ok;
        })
      );
  })
);
