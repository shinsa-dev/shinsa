import { openPairingCredentials, type PairPollResponse, type PairStartResponse } from '@shinsa/core';
import { Clock, Context, Effect, Layer, Option, Schedule } from 'effect';
import { describeError } from '../../log/redact.ts';
import { RemoteClient } from '../client/service.ts';
import { type MachineKeyPair, PairPollInterval, type PairingEnd } from './schema.ts';

export class Pairings extends Context.Service<
  Pairings,
  {
    await(start: PairStartResponse, machine: MachineKeyPair): Effect.Effect<PairingEnd>;
  }
>()('shinsa/engine/remote/pairing/Pairings') {
  static readonly layer = Layer.effect(
    Pairings,
    Effect.gen(function* () {
      const client = yield* RemoteClient;
      const interval = yield* PairPollInterval;
      const pollSchedule = Schedule.spaced(interval);

      const openClaim = Effect.fn('Pairings.openClaim')(function* (
        machine: MachineKeyPair,
        claimed: Extract<PairPollResponse, { status: 'claimed' }>
      ) {
        if (!('sealedCredentials' in claimed)) {
          yield* Effect.logError(
            '[Remote] The pairing credentials arrived unsealed, so this machine refused them'
          );
          return { status: 'expired' } as const;
        }
        const credentials = yield* openPairingCredentials(machine, claimed.sealedCredentials);
        if (credentials)
          return { status: 'claimed', machine: { credentials, owner: claimed.owner } } as const;
        yield* Effect.logError('[Remote] The pairing credentials did not open with this machine key');
        return { status: 'expired' } as const;
      });

      const poll = Effect.fn('Pairings.poll')(function* (start: PairStartResponse, machine: MachineKeyPair) {
        const now = yield* Clock.currentTimeMillis;
        if (now >= start.expiresAt) return Option.some<PairingEnd>({ status: 'expired' });
        const answer = yield* client.pairing
          .poll({ claimCode: start.claimCode, pollSecret: start.pollSecret })
          .pipe(
            Effect.map(Option.some),
            Effect.catch((error) =>
              Effect.logWarning('[Remote] Could not check on pairing; trying again').pipe(
                Effect.annotateLogs({ error: describeError(error) }),
                Effect.as(Option.none())
              )
            )
          );
        if (Option.isNone(answer)) return Option.none<PairingEnd>();
        const polled = answer.value;
        if (polled.status === 'claimed') return Option.some<PairingEnd>(yield* openClaim(machine, polled));
        if (polled.status === 'expired') return Option.some<PairingEnd>({ status: 'expired' });
        return Option.none<PairingEnd>();
      });

      return Pairings.of({
        await: Effect.fn('Pairings.await')(function* (start, machine) {
          yield* Effect.sleep(interval);
          const end = yield* Effect.repeat(poll(start, machine), {
            schedule: pollSchedule,
            until: Option.isSome,
          });
          return Option.getOrThrow(end);
        }),
      });
    })
  );
}
