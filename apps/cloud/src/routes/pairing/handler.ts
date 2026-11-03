import { ClaimCode, isSameSecret, type PairPollResponse, parsePublicKey, REMOTE_PATHS } from '@shinsa/core';
import { RemoteApi } from '@shinsa/core/remote/api';
import { BodyInvalid, RateLimited } from '@shinsa/core/remote/errors';
import { Clock, Duration, Effect, Option, Redacted, Schema } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { CloudConfig } from '../../config/service.ts';
import { CloudCrypto } from '../../crypto/service.ts';
import { Pairings } from '../../store/pairings/service.ts';
import { EXPIRED, MAX_PENDING_PAIRS_PER_ADDRESS, PAIR_TTL } from './schema.ts';

export const PairingHandlers = HttpApiBuilder.group(
  RemoteApi,
  'pairing',
  Effect.fn(function* (handlers) {
    const config = yield* CloudConfig;
    const crypto = yield* CloudCrypto;
    const pairings = yield* Pairings;
    const decodeClaimCode = Schema.decodeUnknownOption(ClaimCode);

    return handlers
      .handle(
        'start',
        Effect.fn('pairing.start')(function* ({ payload }) {
          if (!(yield* Effect.promise(() => parsePublicKey(payload.publicKey))))
            return yield* new BodyInvalid({ message: 'The machine key is not a P-256 public key.' });
          yield* pairings.removeExpired;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const clientIp = request.headers['cf-connecting-ip'] ?? 'unknown';
          if ((yield* pairings.countFrom(clientIp)) >= MAX_PENDING_PAIRS_PER_ADDRESS)
            return yield* new RateLimited({
              message: 'Too many pairings are waiting. Try again in a few minutes.',
            });
          const claimCode = yield* crypto.createClaimCode;
          const pollSecret = yield* crypto.createToken();
          const expiresAt = (yield* Clock.currentTimeMillis) + Duration.toMillis(PAIR_TTL);
          yield* pairings.create(
            {
              claimCode,
              pollSecretHash: yield* crypto.hashToken(pollSecret),
              name: payload.name,
              publicKey: payload.publicKey,
              version: payload.version,
              expiresAt,
            },
            clientIp
          );
          return {
            claimCode,
            pollSecret: Redacted.value(pollSecret),
            url: `${config.origin}${REMOTE_PATHS.pairPage}?code=${claimCode}`,
            expiresAt,
          };
        })
      )
      .handle(
        'poll',
        Effect.fn('pairing.poll')(function* ({ payload }) {
          const claimCode = decodeClaimCode(payload.claimCode);
          if (Option.isNone(claimCode)) return EXPIRED;
          const pairing = yield* pairings.select(claimCode.value);
          const secretHash = yield* crypto.hashToken(Redacted.make(payload.pollSecret));
          if (Option.isNone(pairing) || !isSameSecret(pairing.value.pollSecretHash, secretHash))
            return EXPIRED;
          const { credentials, owner, expiresAt } = pairing.value;
          if (credentials && owner) {
            yield* pairings.remove(claimCode.value);
            return { status: 'claimed', sealedCredentials: credentials, owner } satisfies PairPollResponse;
          }
          if (expiresAt > (yield* Clock.currentTimeMillis))
            return { status: 'pending' } satisfies PairPollResponse;
          yield* pairings.remove(claimCode.value);
          return EXPIRED;
        })
      );
  })
);
