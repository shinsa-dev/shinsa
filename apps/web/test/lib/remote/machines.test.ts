import { describe, expect, it } from 'bun:test';
import { type RemoteInstance, serializePublicKey } from '@shinsa/core';
import { waitFor } from '@testing-library/react';
import { Connection } from '@/lib/connection/socket.ts';
import { openRemoteChannel } from '@/lib/remote/channel.ts';
import type { EnrolledDevice } from '@/lib/remote/devices.ts';
import {
  createFleetMember,
  describeMachine,
  listMachineRows,
  listTaskCapacityItems,
  parseTaskCapacity,
  resolveMachineDetail,
  resolveTaskCapacityValue,
} from '@/lib/remote/machines.ts';
import { createKeyPair, FakeMac } from './fake-mac.ts';

const NOW = Date.UTC(2026, 9, 30, 12);

const STUDIO: RemoteInstance = {
  id: 'k3x9',
  name: 'Studio',
  fingerprint: 'abcd',
  online: true,
  lastSeenAt: NOW,
  createdAt: 0,
  owner: { id: '1', login: 'mona', name: null, avatarUrl: null },
  role: 'owner',
};

async function createDevice(machineKey: string): Promise<EnrolledDevice> {
  return { instanceId: STUDIO.id, machineKey, keys: await createKeyPair(), enrolledAt: 1 };
}

describe('a machine in the dashboard', () => {
  it('names the owner of a machine someone shared with you', () => {
    const shared: RemoteInstance = {
      ...STUDIO,
      owner: { id: '3', login: 'lee', name: null, avatarUrl: null },
      role: 'member',
    };
    expect(describeMachine(shared, null, NOW).access).toBe('Shared by @lee · Not added on this device');
  });

  it('names who handed you a task on a machine, and the task once it is in this dashboard', async () => {
    const handed: RemoteInstance = {
      ...STUDIO,
      owner: { id: '3', login: 'lee', name: 'Lee Park', avatarUrl: null },
      role: 'guest',
    };
    const row = describeMachine(handed, await createDevice('key'), NOW);
    expect(row.access).toBe('A task handed to you by Lee Park · In this dashboard');
    const machine = {
      id: STUDIO.id,
      name: 'Studio',
      current: false,
      guest: true as const,
      state: {
        tasks: { t1: { stage: 'building' as const } },
        projects: {},
        settings: { taskCapacity: null, placementPolicies: [] },
      },
    };
    expect(resolveMachineDetail(row, undefined, machine, { t1: { title: 'Fix the tab bar' } })).toBe(
      'A task handed to you by Lee Park · In this dashboard · Fix the tab bar'
    );
    expect(resolveMachineDetail(row, undefined, machine)).toBe(row.access);
    expect(resolveMachineDetail(row, undefined, undefined)).toBe(row.access);
    expect(resolveMachineDetail(row, { ...machine, guest: undefined }, undefined)).toBe(
      'A task handed to you by Lee Park · In this dashboard · 1 open task'
    );
  });

  it('says whether it is online and whether this browser has it in its dashboard', async () => {
    const device = await createDevice('key');
    expect(describeMachine(STUDIO, device, NOW)).toMatchObject({
      label: 'Studio',
      status: 'Online',
      access: 'In this dashboard',
      device,
    });
    expect(describeMachine(STUDIO, null, NOW).access).toBe('Not added on this device');
    expect(describeMachine(STUDIO, { ...device, onMachine: true }, NOW)).toMatchObject({
      label: 'This machine',
      access: 'Studio · In this dashboard',
    });
  });

  it('says when it was last seen, or that it never connected', () => {
    expect(
      describeMachine({ ...STUDIO, online: false, lastSeenAt: NOW - 3 * 60_000 }, null, NOW).status
    ).toBe('Last seen 3m ago');
    expect(describeMachine({ ...STUDIO, online: false, lastSeenAt: null }, null, NOW).status).toBe(
      'Never connected'
    );
  });

  it('lists every machine of the account with this browser’s device for it', async () => {
    const device = await createDevice('key');
    const rows = await listMachineRows(
      { listInstances: () => Promise.resolve([STUDIO, { ...STUDIO, id: 'm2', name: 'Laptop' }]) },
      { selectDevice: (id) => Promise.resolve(id === STUDIO.id ? device : null) },
      NOW
    );
    expect(rows.map((row) => [row.instance.name, row.device !== null])).toEqual([
      ['Studio', true],
      ['Laptop', false],
    ]);
  });

  it('becomes a fleet member whose socket and requests go over its own sealed channel', async () => {
    const keys = await createKeyPair();
    const mac = await FakeMac.create({
      enrolled: [await serializePublicKey(keys.publicKey)],
      respond: () => new Response('from Studio'),
    });
    const device: EnrolledDevice = { instanceId: STUDIO.id, machineKey: mac.machineKey, keys, enrolledAt: 1 };
    const sockets: (() => WebSocket)[] = [];
    const { member, close } = createFleetMember(STUDIO, device, {
      dashboard: {
        requestConnect: () => Promise.resolve({ url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 }),
      },
      onRefused: () => undefined,
      openChannel: (options) => openRemoteChannel({ ...options, openSocket: mac.openSocket }),
      createConnection: (openSocket) => {
        sockets.push(openSocket);
        return new Connection({ openSocket, retry: () => undefined });
      },
    });
    expect(member).toMatchObject({ id: 'k3x9', name: 'Studio' });
    expect(member.guest).toBeUndefined();
    const handed = createFleetMember({ ...STUDIO, role: 'guest' }, device, {
      dashboard: { requestConnect: () => Promise.reject(new Error('unused')) },
      onRefused: () => undefined,
      createConnection: () =>
        new Connection({ openSocket: () => new WebSocket('ws://x'), retry: () => undefined }),
    });
    expect(handed.member.guest).toBe(true);
    expect(handed.member.handedBy).toEqual(STUDIO.owner);
    handed.close();
    const answer = await member.fetch(new Request('https://shinsa.dev/api/health'));
    expect(await answer.text()).toBe('from Studio');
    const socket = sockets[0]?.();
    await waitFor(() => expect(socket?.readyState).toBe(1));
    close();
    await waitFor(() => expect(socket?.readyState).toBe(3));
  });

  it('reports the machine that no longer accepts this browser, and builds its own connection by default', async () => {
    const mac = await FakeMac.create({ enrolled: [] });
    const device = await createDevice(mac.machineKey);
    const refused: string[] = [];
    const { member } = createFleetMember(STUDIO, device, {
      dashboard: {
        requestConnect: () => Promise.resolve({ url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 }),
      },
      onRefused: (instanceId, error) => refused.push(`${instanceId}: ${error.message}`),
      openChannel: (options) => openRemoteChannel({ ...options, openSocket: mac.openSocket }),
    });
    expect(member.connection).toBeInstanceOf(Connection);
    await expect(member.fetch(new Request('https://shinsa.dev/api/health'))).rejects.toThrow('not enrolled');
    expect(refused).toEqual(['k3x9: This browser is not enrolled on this machine.']);
  });
});

describe('a machine’s task capacity', () => {
  it('offers no limit and a few sizes, keeps a size set elsewhere, and reads a choice back', () => {
    expect(listTaskCapacityItems(null).map((item) => item.value)).toEqual(['none', '2', '4', '8', '16']);
    expect(listTaskCapacityItems(6).map((item) => item.label)).toContain('Up to 6 open tasks');
    expect(resolveTaskCapacityValue(null)).toBe('none');
    expect(resolveTaskCapacityValue(8)).toBe('8');
    expect(parseTaskCapacity('none')).toBeNull();
    expect(parseTaskCapacity('8')).toBe(8);
  });
});
