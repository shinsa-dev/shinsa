import { InstanceId, type RemoteUser, RemoteUserId } from '@shinsa/core';
import { Effect, Redacted } from 'effect';
import { TokenHash } from '../../src/crypto/schema.ts';
import { Accounts } from '../../src/store/accounts/service.ts';
import { Machines } from '../../src/store/machines/service.ts';

export const MONA = {
  id: RemoteUserId.make('42'),
  login: 'mona',
  name: 'Mona Lisa',
  avatarUrl: 'https://a/42',
};

export const KAI = { id: RemoteUserId.make('7'), login: 'kai', name: null, avatarUrl: null };

export const RIO = { id: RemoteUserId.make('9'), login: 'rio', name: null, avatarUrl: null };

export const STUDIO = InstanceId.make('studio000001');

export const LAPTOP = InstanceId.make('laptop000001');

export function hashOf(character: string) {
  return TokenHash.make(character.repeat(64));
}

export const seedUsers = (...users: RemoteUser[]) =>
  Accounts.use((accounts) => Effect.forEach(users, accounts.upsertUser, { discard: true }));

export const seedMachine = (id: InstanceId, userId: RemoteUserId, token = 'a') =>
  Machines.use((machines) =>
    machines.create({
      id,
      userId,
      name: `Machine ${id}`,
      fingerprint: `fp-${id}`,
      tunnelId: `tunnel-${id}`,
      dnsRecordId: `record-${id}`,
      machineTokenHash: hashOf(token),
      connectKey: Redacted.make(`connect-${id}`),
    })
  );
