import {
  APP_IDENTITY,
  ClaimCode,
  isSameSecret,
  type MachineCredentials,
  type PairPollResponse,
  parsePublicKey,
  REMOTE_PATHS,
  resolveKeyFingerprint,
  resolveTunnelHost,
} from '@shinsa/core';
import { CurrentUser, RemoteApi } from '@shinsa/core/remote/api';
import {
  BodyInvalid,
  InstancesFull,
  PairClaimed,
  PairExpired,
  RateLimited,
  ServiceFull,
} from '@shinsa/core/remote/errors';
import { Clock, Duration, Effect, Option, Redacted, Schema } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { CloudConfig } from '../config/config.ts';
import { CloudCrypto } from '../crypto/crypto.ts';
import { Cloudflare } from '../integrations/cloudflare.ts';
import { Machines } from '../store/machines.ts';
import { Pairings } from '../store/pairings.ts';

export const PAIR_TTL = Duration.minutes(10);

export const MAX_PENDING_PAIRS_PER_ADDRESS = 10;

export const MAX_INSTANCES_PER_USER = 5;

const DEFAULT_LOCAL_URL = `http://127.0.0.1:${APP_IDENTITY.port}`;

const decodeClaimCode = Schema.decodeUnknownOption(ClaimCode);

const EXPIRED: PairPollResponse = { status: 'expired' };

export const PairingHandlers = HttpApiBuilder.group(
  RemoteApi,
  'pairing',
  Effect.fn(function* (handlers) {
    const config = yield* CloudConfig;
    const crypto = yield* CloudCrypto;
    const pairings = yield* Pairings;

    return handlers
      .handle('start', ({ payload }) =>
        Effect.gen(function* () {
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
      .handle('poll', ({ payload }) =>
        Effect.gen(function* () {
          const claimCode = decodeClaimCode(payload.claimCode);
          if (Option.isNone(claimCode)) return EXPIRED;
          const pairing = yield* pairings.select(claimCode.value);
          const secretHash = yield* crypto.hashToken(Redacted.make(payload.pollSecret));
          if (Option.isNone(pairing) || !isSameSecret(pairing.value.pollSecretHash, secretHash))
            return EXPIRED;
          const { credentials, owner, expiresAt } = pairing.value;
          if (credentials && owner) {
            yield* pairings.remove(claimCode.value);
            return { status: 'claimed', credentials, owner } satisfies PairPollResponse;
          }
          if (expiresAt > (yield* Clock.currentTimeMillis))
            return { status: 'pending' } satisfies PairPollResponse;
          yield* pairings.remove(claimCode.value);
          return EXPIRED;
        })
      );
  })
);

const findLivePairing = Effect.fn('findLivePairing')(function* (claimCode: ClaimCode) {
  const pairings = yield* Pairings;
  const pairing = yield* pairings.select(ClaimCode.make(claimCode.toUpperCase()));
  if (Option.isNone(pairing) || pairing.value.expiresAt <= (yield* Clock.currentTimeMillis))
    return yield* new PairExpired({
      message: 'This pairing code expired. Turn remote access on again on your machine.',
    });
  return pairing.value;
});

export const PairsHandlers = HttpApiBuilder.group(
  RemoteApi,
  'pairs',
  Effect.fn(function* (handlers) {
    const config = yield* CloudConfig;
    const crypto = yield* CloudCrypto;
    const pairings = yield* Pairings;
    const machines = yield* Machines;
    const cloudflare = yield* Cloudflare;

    const createMachine = Effect.fn('pairs.createMachine')(function* (
      pairing: Effect.Success<ReturnType<typeof findLivePairing>>,
      userId: CurrentUser['Service']['id']
    ) {
      const instanceId = yield* crypto.createInstanceId;
      const tunnelHost = resolveTunnelHost(instanceId);
      const tunnel = yield* cloudflare.createTunnel(`shinsa-${instanceId}`, tunnelHost, DEFAULT_LOCAL_URL);
      const machineToken = yield* crypto.createToken();
      const connectKey = yield* crypto.createToken();
      yield* machines.create({
        id: instanceId,
        userId,
        name: pairing.name,
        fingerprint: yield* Effect.promise(() => resolveKeyFingerprint(pairing.publicKey)),
        tunnelId: tunnel.tunnelId,
        dnsRecordId: tunnel.dnsRecordId,
        machineTokenHash: yield* crypto.hashToken(machineToken),
        connectKey,
      });
      const credentials: MachineCredentials = {
        instanceId,
        machineToken: Redacted.value(machineToken),
        tunnelToken: Redacted.value(tunnel.tunnelToken),
        tunnelHost,
        connectKey: Redacted.value(connectKey),
      };
      yield* pairings.recordClaim(pairing.claimCode, credentials);
      return instanceId;
    });

    return handlers
      .handle('view', ({ params }) =>
        Effect.gen(function* () {
          const pairing = yield* findLivePairing(params.claimCode);
          return {
            claimCode: pairing.claimCode,
            name: pairing.name,
            fingerprint: yield* Effect.promise(() => resolveKeyFingerprint(pairing.publicKey)),
            expiresAt: pairing.expiresAt,
            claimed: pairing.credentials !== null,
          };
        })
      )
      .handle('approve', ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const pairing = yield* findLivePairing(params.claimCode);
          if ((yield* machines.countOwned(user.id)) >= MAX_INSTANCES_PER_USER)
            return yield* new InstancesFull({
              message: `You can pair up to ${MAX_INSTANCES_PER_USER} machines. Remove one on the dashboard first.`,
            });
          if ((yield* machines.count) >= config.maxInstances)
            return yield* new ServiceFull({
              message: 'Remote access has no room for another machine right now. Try again later.',
            });
          if (!(yield* pairings.reserve(pairing.claimCode, user.login)))
            return yield* new PairClaimed({ message: 'This machine is already paired.' });
          const instanceId = yield* createMachine(pairing, user.id).pipe(
            Effect.onError(() => pairings.release(pairing.claimCode))
          );
          return { instanceId, name: pairing.name };
        })
      );
  })
);
