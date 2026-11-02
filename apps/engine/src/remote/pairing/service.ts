import type { PairStartResponse } from '@shinsa/core';
import { Clock, Context, Effect, Layer, Option, Schedule } from 'effect';
import { describeError } from '../../log/redact.ts';
import { RemoteClient } from '../client/service.ts';
import { PairPollInterval, type PairingEnd } from './schema.ts';

export class Pairings extends Context.Service<
  Pairings,
  {
    await(start: PairStartResponse): Effect.Effect<PairingEnd>;
  }
>()('shinsa/engine/remote/pairing/Pairings') {
  static readonly layer = Layer.effect(
    Pairings,
    Effect.gen(function* () {
      const client = yield* RemoteClient;
      const interval = yield* PairPollInterval;
      const pollSchedule = Schedule.spaced(interval);

      const poll = Effect.fn('Pairings.poll')(function* (start: PairStartResponse) {
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
        return Option.flatMap(answer, (polled): Option.Option<PairingEnd> => {
          if (polled.status === 'claimed')
            return Option.some({
              status: 'claimed',
              machine: { credentials: polled.credentials, owner: polled.owner },
            });
          if (polled.status === 'expired') return Option.some({ status: 'expired' });
          return Option.none();
        });
      });

      return Pairings.of({
        await: Effect.fn('Pairings.await')(function* (start) {
          yield* Effect.sleep(interval);
          const end = yield* Effect.repeat(poll(start), { schedule: pollSchedule, until: Option.isSome });
          return Option.getOrThrow(end);
        }),
      });
    })
  );
}
