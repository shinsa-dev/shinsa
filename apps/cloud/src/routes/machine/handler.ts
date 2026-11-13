import {
  type InstanceId,
  MAX_INSTANCE_GUESTS,
  MAX_INSTANCE_MEMBERS,
  type RemoteMember,
  type RemoteUserId,
} from '@shinsa/core';
import { CurrentMachine, RemoteApi } from '@shinsa/core/remote/api';
import { GuestsFull, MembersFull, NotFound, Revoked } from '@shinsa/core/remote/errors';
import { Clock, Effect, Option, Redacted } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { selectMachineRole } from '../../auth/access.ts';
import { NOT_PAIRED } from '../../auth/schema.ts';
import type { TokenHash } from '../../crypto/schema.ts';
import { CloudCrypto } from '../../crypto/service.ts';
import { listMachinePeople, removeMachine } from '../../domain/machines.ts';
import { listUserTeams } from '../../domain/teams.ts';
import { MachineAccess } from '../../store/access/service.ts';
import { Accounts } from '../../store/accounts/service.ts';
import { Machines } from '../../store/machines/service.ts';
import type { Membership } from '../../store/shared/schema.ts';
import { Teams } from '../../store/teams/service.ts';
import { NOT_ASKED } from './schema.ts';
export const MachineHandlers = HttpApiBuilder.group(
  RemoteApi,
  'machine',
  Effect.fn(function* (handlers) {
    const findCurrentMachine = Effect.gen(function* () {
      const machines = yield* Machines;
      const { instanceId } = yield* CurrentMachine;
      const machine = yield* machines.select(instanceId);
      if (Option.isNone(machine)) return yield* new Revoked({ message: NOT_PAIRED });
      return machine.value;
    });

    const reachesMachine = Effect.fn('reachesMachine')(function* (userId: RemoteUserId) {
      const { instanceId, ownerId } = yield* CurrentMachine;
      const role = yield* selectMachineRole(instanceId, ownerId, userId);
      return Option.isSome(role) && role.value !== 'guest';
    });

    const hasAsked = Effect.fn('hasAsked')(function* (userId: RemoteUserId) {
      const { instanceId, ownerId } = yield* CurrentMachine;
      const access = yield* MachineAccess;
      const teams = yield* Teams;
      if (yield* reachesMachine(userId)) return true;
      if (yield* access.requesters.has(instanceId, userId)) return true;
      return yield* teams.shareTeam(ownerId, userId);
    });

    const findAskingUser = Effect.fn('findAskingUser')(function* (userId: RemoteUserId, isGuestToo = false) {
      const { instanceId } = yield* CurrentMachine;
      const access = yield* MachineAccess;
      const accounts = yield* Accounts;
      const asked =
        (isGuestToo && (yield* access.guests.has(instanceId, userId))) || (yield* hasAsked(userId));
      const user = asked ? yield* accounts.selectUser(userId) : Option.none();
      if (Option.isNone(user)) return yield* new NotFound({ message: NOT_ASKED });
      return user.value;
    });

    const machines = yield* Machines;
    const access = yield* MachineAccess;
    const crypto = yield* CloudCrypto;

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
      const { instanceId } = yield* CurrentMachine;
      const user = yield* findAskingUser(userId, slot.membership === access.guests);
      const now = yield* Clock.currentTimeMillis;
      if (!(yield* reachesMachine(userId)) && !(yield* slot.membership.has(instanceId, userId))) {
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
      .handle(
        'heartbeat',
        Effect.fn('machine.heartbeat')(function* ({ payload }) {
          const machine = yield* findCurrentMachine;
          yield* machines.recordHeartbeat(machine.id, {
            localUrl: payload.localUrl,
            signingKey: payload.signingKey ?? null,
            features: payload.features ?? [],
          });
          const { owner, members, guests } = yield* listMachinePeople(machine);
          return { ok: true as const, owner, members, guests, teams: yield* listUserTeams(machine.ownerId) };
        })
      )
      .handle(
        'offline',
        Effect.fn('machine.offline')(function* () {
          yield* machines.recordOffline((yield* CurrentMachine).instanceId);
          return ok;
        })
      )
      .handle(
        'remove',
        Effect.fn('machine.remove')(function* () {
          yield* removeMachine(yield* findCurrentMachine);
          return ok;
        })
      )
      .handle('inviteCreate', () => createLink(access.invites.replace))
      .handle(
        'inviteRemove',
        Effect.fn('machine.inviteRemove')(function* () {
          yield* access.invites.remove((yield* CurrentMachine).instanceId);
          return ok;
        })
      )
      .handle('requesterFind', ({ payload }) => findAskingUser(payload.userId))
      .handle('memberAdd', ({ payload }) => addPerson(payload.userId, memberSlot))
      .handle(
        'memberRemove',
        Effect.fn('machine.memberRemove')(function* ({ payload }) {
          yield* access.members.remove((yield* CurrentMachine).instanceId, payload.userId);
          return ok;
        })
      )
      .handle('handoffCreate', () => createLink(access.handoffs.create))
      .handle(
        'handoffRemove',
        Effect.fn('machine.handoffRemove')(function* ({ payload }) {
          const { instanceId } = yield* CurrentMachine;
          yield* access.handoffs.remove(instanceId, yield* crypto.hashToken(Redacted.make(payload.token)));
          return ok;
        })
      )
      .handle('guestAdd', ({ payload }) => addPerson(payload.userId, guestSlot))
      .handle(
        'guestRemove',
        Effect.fn('machine.guestRemove')(function* ({ payload }) {
          yield* access.guests.remove((yield* CurrentMachine).instanceId, payload.userId);
          return ok;
        })
      );
  })
);
