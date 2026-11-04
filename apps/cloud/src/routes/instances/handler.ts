import type { InstanceId } from '@shinsa/core';
import { CurrentUser, RemoteApi } from '@shinsa/core/remote/api';
import { HandoffInvalid, InviteInvalid, OwnerCannotLeave } from '@shinsa/core/remote/errors';
import { Clock, Effect, Option, Redacted } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { findMachineAccess, findOwnMachine, findReachableMachine } from '../../auth/access.ts';
import type { TokenHash } from '../../crypto/schema.ts';
import { CloudCrypto } from '../../crypto/service.ts';
import {
  createConnectAnswer,
  findMachineOwner,
  removeMachine,
  serializeInstance,
} from '../../domain/machines.ts';
import { MachineAccess } from '../../store/access/service.ts';
import type { Machine } from '../../store/machines/schema.ts';
import { Machines } from '../../store/machines/service.ts';
export const InstancesHandlers = HttpApiBuilder.group(
  RemoteApi,
  'instances',
  Effect.fn(function* (handlers) {
    const answerAccept = Effect.fn('answerAccept')(function* (
      machine: Machine,
      user: CurrentUser['Service']
    ) {
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

    const machines = yield* Machines;
    const access = yield* MachineAccess;

    return handlers
      .handle(
        'list',
        Effect.fn('instances.list')(function* () {
          const user = yield* CurrentUser;
          const now = yield* Clock.currentTimeMillis;
          return (yield* machines.listOfUser(user.id)).map((shared) => serializeInstance(shared, now));
        })
      )
      .handle(
        'connect',
        Effect.fn('instances.connect')(function* ({ params }) {
          const user = yield* CurrentUser;
          return yield* createConnectAnswer(yield* findReachableMachine(user.id, params.instanceId), user.id);
        })
      )
      .handle(
        'remove',
        Effect.fn('instances.remove')(function* ({ params }) {
          const user = yield* CurrentUser;
          yield* removeMachine(yield* findOwnMachine(user.id, params.instanceId));
          return { ok: true as const };
        })
      )
      .handle(
        'leave',
        Effect.fn('instances.leave')(function* ({ params }) {
          const user = yield* CurrentUser;
          const { machine, role } = yield* findMachineAccess(user.id, params.instanceId);
          if (role === 'owner')
            return yield* new OwnerCannotLeave({ message: 'You own this machine. Remove it instead.' });
          const membership = role === 'member' ? access.members : access.guests;
          yield* membership.remove(machine.id, user.id);
          return { ok: true as const };
        })
      )
      .handle(
        'inviteAccept',
        Effect.fn('instances.inviteAccept')(function* ({ payload }) {
          const machine = yield* selectTokenMachine(access.invites.select, payload.token);
          if (Option.isNone(machine))
            return yield* new InviteInvalid({
              message: 'This invite link was turned off. Ask the machine’s owner for a new one.',
            });
          return yield* answerAccept(machine.value, yield* CurrentUser);
        })
      )
      .handle(
        'handoffAccept',
        Effect.fn('instances.handoffAccept')(function* ({ payload }) {
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
