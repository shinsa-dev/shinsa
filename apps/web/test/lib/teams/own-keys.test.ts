import { describe, expect, it } from 'bun:test';
import type { RemoteInstance } from '@shinsa/core';
import { describeMachine } from '@/lib/remote/machines.ts';
import type { EnrolledDevice } from '@/lib/remote/schema.ts';
import { syncOwnTeamKeys } from '@/lib/teams/own-keys.ts';
import type { StoredTeamKey } from '@/lib/teams/schema.ts';

const MONA = { id: '1', login: 'mona', name: null, avatarUrl: null };

const STUDIO: RemoteInstance = {
  id: 'studio',
  name: 'Studio',
  fingerprint: 'abcd',
  online: true,
  lastSeenAt: 1,
  createdAt: 0,
  owner: MONA,
  role: 'owner',
};

const ORIGIN = 'https://app.shinsa.dev';

function createDevice(instanceId: string): EnrolledDevice {
  return { instanceId, machineKey: 'key', keys: {} as CryptoKeyPair, enrolledAt: 1 };
}

function createKeyStore(entries: StoredTeamKey[] = []) {
  const stored = new Map(entries.map((entry) => [entry.teamId, entry]));
  return {
    stored,
    selectTeamKey: (teamId: string) => Promise.resolve(stored.get(teamId) ?? null),
    writeTeamKey: (entry: StoredTeamKey) => {
      stored.set(entry.teamId, entry);
      return Promise.resolve();
    },
  };
}

function answering(answers: Record<string, () => Promise<Response>>) {
  const closed: string[] = [];
  return {
    closed,
    createMember: (row: { instance: RemoteInstance }) => ({
      member: {
        id: row.instance.id,
        name: row.instance.name,
        fetch: (request: Request) => {
          expect(new URL(request.url).pathname).toBe('/api/remote/teams/keys');
          return (answers[row.instance.id] ?? (() => Promise.reject(new Error('offline'))))();
        },
      },
      close: () => closed.push(row.instance.id),
    }),
  };
}

describe('team keys from your own machines', () => {
  it('stores each key your machines hold that this browser lacks, and closes every channel', async () => {
    const teamKeys = createKeyStore([{ teamId: 'old', name: 'Old', key: 'same', joinedAt: 5 }]);
    const { closed, createMember } = answering({
      studio: () =>
        Promise.resolve(
          Response.json({
            keys: [
              { teamId: 'core', name: 'Core', key: 'k1' },
              { teamId: 'old', name: 'Old', key: 'same' },
            ],
          })
        ),
    });
    const rows = [
      describeMachine(STUDIO, createDevice(STUDIO.id), 1),
      describeMachine({ ...STUDIO, id: 'laptop', name: 'Laptop' }, createDevice('laptop'), 1),
      describeMachine({ ...STUDIO, id: 'kai', role: 'teammate' }, createDevice('kai'), 1),
    ];
    const added = await syncOwnTeamKeys(rows, {
      dashboard: { requestConnect: () => Promise.reject(new Error('unused')) },
      teamKeys,
      origin: ORIGIN,
      now: () => 9,
      createMember,
    });
    expect(added).toBe(1);
    expect(teamKeys.stored.get('core')).toEqual({ teamId: 'core', name: 'Core', key: 'k1', joinedAt: 9 });
    expect(teamKeys.stored.get('old')?.joinedAt).toBe(5);
    expect([...closed].sort()).toEqual(['laptop', 'studio']);
  });

  it('adds nothing when the browser cannot store the key', async () => {
    const { createMember } = answering({
      studio: () => Promise.resolve(Response.json({ keys: [{ teamId: 'core', name: 'Core', key: 'k1' }] })),
    });
    const added = await syncOwnTeamKeys([describeMachine(STUDIO, createDevice(STUDIO.id), 1)], {
      dashboard: { requestConnect: () => Promise.reject(new Error('unused')) },
      teamKeys: {
        selectTeamKey: () => Promise.resolve(null),
        writeTeamKey: () => Promise.reject(new Error('full')),
      },
      origin: ORIGIN,
      createMember,
    });
    expect(added).toBe(0);
  });
});
