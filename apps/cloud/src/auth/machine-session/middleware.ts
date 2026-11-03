import { CurrentMachine, MachineSession } from '@shinsa/core/remote/api';
import { Revoked } from '@shinsa/core/remote/errors';
import { Effect, Layer, Option, Redacted } from 'effect';
import { CloudCrypto } from '../../crypto/service.ts';
import { Machines } from '../../store/machines/service.ts';
import { NOT_PAIRED } from '../schema.ts';

export const MachineSessionLive = Layer.effect(
  MachineSession,
  Effect.gen(function* () {
    const machines = yield* Machines;
    const crypto = yield* CloudCrypto;

    return MachineSession.of({
      bearer: Effect.fn('MachineSession.bearer')(function* (httpEffect, { credential }) {
        const revoked = new Revoked({ message: NOT_PAIRED });
        if (Redacted.value(credential) === '') return yield* revoked;
        const machine = yield* machines.selectByToken(yield* crypto.hashToken(credential));
        if (Option.isNone(machine)) return yield* revoked;
        return yield* Effect.provideService(httpEffect, CurrentMachine, {
          instanceId: machine.value.id,
          ownerId: machine.value.userId,
        });
      }),
    });
  })
);
