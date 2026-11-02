import {
  CONNECT_TOKEN_TTL_MS,
  type ConnectResponse,
  createConnectToken,
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
import { MachineAccess } from '../store/access.ts';
import { Accounts } from '../store/accounts.ts';
import type { Machine, SharedMachine } from '../store/machines.ts';

export const ONLINE_WINDOW = Duration.minutes(5);

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

export type ChannelKind = 'remote' | 'team';

function resolveChannelUrl(machine: Machine, token: string, channel: ChannelKind) {
  const tunnel = resolveTunnelUrl(machine);
  if (channel === 'team') return resolveTeamChannelUrl(tunnel, token);
  return `${tunnel}${REMOTE_CHANNEL_PATH}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`;
}

export const createConnectAnswer = Effect.fn('createConnectAnswer')(function* (
  machine: Machine,
  userId: string,
  channel: ChannelKind = 'remote'
) {
  const expiresAt = (yield* Clock.currentTimeMillis) + CONNECT_TOKEN_TTL_MS;
  const token = yield* Effect.promise(() =>
    createConnectToken(Redacted.value(machine.connectKey), { instanceId: machine.id, userId, expiresAt })
  );
  return { url: resolveChannelUrl(machine, token, channel), expiresAt } satisfies ConnectResponse;
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
