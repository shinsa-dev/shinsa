import { ClaimCode, type MachineCredentials, resolveKeyFingerprint, resolveTunnelHost } from '@shinsa/core';
import { CurrentUser, RemoteApi } from '@shinsa/core/remote/api';
import { InstancesFull, PairClaimed, PairExpired, ServiceFull } from '@shinsa/core/remote/errors';
import { Clock, Effect, Option, Redacted } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { CloudConfig } from '../../config/service.ts';
import { CloudCrypto } from '../../crypto/service.ts';
import { Cloudflare } from '../../integrations/cloudflare/service.ts';
import { Machines } from '../../store/machines/service.ts';
import { Pairings } from '../../store/pairings/service.ts';
import { DEFAULT_LOCAL_URL, MAX_INSTANCES_PER_USER } from './schema.ts';
export const PairsHandlers = HttpApiBuilder.group(
  RemoteApi,
  'pairs',
  Effect.fn(function* (handlers) {
    const findLivePairing = Effect.fn('findLivePairing')(function* (claimCode: ClaimCode) {
      const pairings = yield* Pairings;
      const pairing = yield* pairings.select(ClaimCode.make(claimCode.toUpperCase()));
      if (Option.isNone(pairing) || pairing.value.expiresAt <= (yield* Clock.currentTimeMillis))
        return yield* new PairExpired({
          message: 'This pairing code expired. Turn remote access on again on your machine.',
        });
      return pairing.value;
    });

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
      .handle(
        'view',
        Effect.fn('pairs.view')(function* ({ params }) {
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
      .handle(
        'approve',
        Effect.fn('pairs.approve')(function* ({ params }) {
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
