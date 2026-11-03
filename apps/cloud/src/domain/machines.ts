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
  resolveTeamChannelUrl,
  resolveTunnelHost,
} from '@shinsa/core';
import { NotFound } from '@shinsa/core/remote/errors';
import { Clock, Duration, Effect, Option, Redacted } from 'effect';
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
  const token = yield* Effect.promise(() =>
    hasMachineFeature(machine.features, 'bound-connect-tokens')
      ? createConnectToken(connectKey, { instanceId: machine.id, userId, channel, nonce, expiresAt })
      : createLegacyConnectToken(connectKey, { instanceId: machine.id, userId, expiresAt })
  );
  const tunnel = resolveTunnelUrl(machine);
  const url =
    channel === 'team'
      ? resolveTeamChannelUrl(tunnel, token)
      : `${tunnel}${REMOTE_CHANNEL_PATH}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`;
  return { url, expiresAt } satisfies ConnectResponse;
});

export const findMachineOwner = Effect.fn('findMachineOwner')(function* (machine: Machine) {
  const accounts = yield* Accounts;
  const owner = yield* accounts.selectUser(machine.userId);
  if (Option.isNone(owner)) return yield* new NotFound({ message: 'No such machine.' });
  return owner.value satisfies RemoteUser;
});

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
