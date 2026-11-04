import {
  type ConnectChannel,
  CONNECT_TOKEN_TTL_MS,
  type ConnectResponse,
  createConnectToken,
  createLegacyConnectToken,
  hasMachineFeature,
  REMOTE_CHANNEL_PATH,
  REMOTE_CONNECT_PARAM,
  type RemoteInstance,
  type RemoteMember,
  type RemoteUser,
  type RemoteUserId,
  resolveTeamChannelUrl,
  resolveTunnelHost,
  type TeamMachine,
} from '@shinsa/core';
import { NotFound } from '@shinsa/core/remote/errors';
import { Clock, Duration, Effect, Option, Redacted } from 'effect';
import { NO_SUCH_MACHINE } from '../auth/schema.ts';
import { CloudCrypto } from '../crypto/service.ts';
import { Cloudflare } from '../integrations/cloudflare/service.ts';
import { MachineAccess } from '../store/access/service.ts';
import { Accounts } from '../store/accounts/service.ts';
import type { Machine, SharedMachine } from '../store/machines/schema.ts';
import { Machines } from '../store/machines/service.ts';
import { CONNECT_NONCE_BYTES, ONLINE_WINDOW } from './schema.ts';

export function isMachineOnline(machine: Machine, now: number) {
  return (
    machine.online &&
    machine.lastSeenAt !== null &&
    machine.lastSeenAt > now - Duration.toMillis(ONLINE_WINDOW)
  );
}

export function resolveTunnelUrl(machine: Machine) {
  return `wss://${resolveTunnelHost(machine.id)}`;
}

export function serializeTeamMachine(machine: Machine, now: number): TeamMachine {
  return {
    id: machine.id,
    name: machine.name,
    userId: machine.ownerId,
    online: isMachineOnline(machine, now),
    lastSeenAt: machine.lastSeenAt,
    ...(machine.signingKey ? { signingKey: machine.signingKey } : {}),
  };
}

export function serializeInstance({ machine, owner, role }: SharedMachine, now: number): RemoteInstance {
  return {
    id: machine.id,
    name: machine.name,
    fingerprint: machine.fingerprint,
    online: isMachineOnline(machine, now),
    lastSeenAt: machine.lastSeenAt,
    createdAt: machine.createdAt,
    owner,
    role,
  };
}

export const createConnectAnswer = Effect.fn('createConnectAnswer')(function* (
  machine: Machine,
  userId: string,
  channel: ConnectChannel = 'remote'
) {
  const crypto = yield* CloudCrypto;
  const expiresAt = (yield* Clock.currentTimeMillis) + CONNECT_TOKEN_TTL_MS;
  const connectKey = Redacted.value(machine.connectKey);
  const nonce = Redacted.value(yield* crypto.createToken(CONNECT_NONCE_BYTES));
  const token = yield* (
    hasMachineFeature(machine.features, 'bound-connect-tokens')
      ? createConnectToken(connectKey, { instanceId: machine.id, userId, channel, nonce, expiresAt })
      : createLegacyConnectToken(connectKey, { instanceId: machine.id, userId, expiresAt })
  ).pipe(Effect.orDie);
  const tunnel = resolveTunnelUrl(machine);
  const url =
    channel === 'team'
      ? resolveTeamChannelUrl(tunnel, token)
      : `${tunnel}${REMOTE_CHANNEL_PATH}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`;
  return { url, expiresAt } satisfies ConnectResponse;
});

export const findOwner = Effect.fn('findOwner')(function* (ownerId: RemoteUserId, missing: string) {
  const accounts = yield* Accounts;
  const owner = yield* accounts.selectUser(ownerId);
  if (Option.isNone(owner)) return yield* new NotFound({ message: missing });
  return owner.value satisfies RemoteUser;
});

export const findMachineOwner = (machine: Machine) => findOwner(machine.ownerId, NO_SUCH_MACHINE);

export const listMachinePeople = Effect.fn('listMachinePeople')(function* (machine: Machine) {
  const access = yield* MachineAccess;
  return {
    owner: yield* findMachineOwner(machine),
    members: yield* access.members.list(machine.id),
    guests: yield* access.guests.list(machine.id),
  } satisfies {
    owner: RemoteUser;
    members: ReadonlyArray<RemoteMember>;
    guests: ReadonlyArray<RemoteMember>;
  };
});

export const removeMachine = Effect.fn('removeMachine')(function* (machine: Machine) {
  const cloudflare = yield* Cloudflare;
  const machines = yield* Machines;
  yield* cloudflare.removeTunnel(machine.tunnelId, machine.dnsRecordId);
  yield* machines.remove(machine.id);
});
