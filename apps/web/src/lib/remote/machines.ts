import type { RemoteInstance } from '@shinsa/core';
import { Connection, retryLater } from '@/lib/connection/socket.ts';
import { formatSince } from '@/lib/format/time.ts';
import type { ChannelError } from './channel.ts';
import type { DashboardClient } from './dashboard.ts';
import type { DeviceStore, EnrolledDevice } from './devices.ts';
import type { FleetMember } from './fleet.ts';
import { RemoteLink, type RemoteLinkOptions } from './link.ts';
import { resolveMachineLabel } from './mode.ts';
import { resolveFirstName } from './users.ts';

export interface MachineRow {
  instance: RemoteInstance;
  device: EnrolledDevice | null;
  label: string;
  status: string;
  access: string;
}

function resolveDeviceAccess(device: EnrolledDevice | null) {
  if (!device) return 'Not added on this device';
  return device.waiting ? 'Waiting for an answer' : 'In this dashboard';
}

export function describeMachine(
  instance: RemoteInstance,
  device: EnrolledDevice | null,
  now = Date.now()
): MachineRow {
  const seen =
    instance.lastSeenAt === null ? 'Never connected' : formatSince('Last seen', instance.lastSeenAt, now);
  const current = device?.onMachine === true;
  const added = resolveDeviceAccess(device);
  const access =
    instance.role === 'member' ? `Shared by ${resolveFirstName(instance.owner)} · ${added}` : added;
  return {
    instance,
    device,
    label: resolveMachineLabel({ name: instance.name, current }),
    status: instance.online ? 'Online' : seen,
    access: current ? `${instance.name} · ${access}` : access,
  };
}

export async function listMachineRows(
  dashboard: Pick<DashboardClient, 'listInstances'>,
  devices: Pick<DeviceStore, 'selectDevice'>,
  now = Date.now()
) {
  const instances = await dashboard.listInstances();
  return Promise.all(
    instances.map(async (instance) => describeMachine(instance, await devices.selectDevice(instance.id), now))
  );
}

export interface FleetMemberOptions {
  dashboard: Pick<DashboardClient, 'requestConnect'>;
  onRefused: (instanceId: string, error: ChannelError) => void;
  onRemoved?: (instanceId: string) => void;
  createConnection?: (openSocket: () => WebSocket) => Connection;
  openChannel?: RemoteLinkOptions['openChannel'];
}

export function createFleetMember(
  instance: RemoteInstance,
  device: EnrolledDevice,
  options: FleetMemberOptions
) {
  const link = new RemoteLink({
    instanceId: instance.id,
    device,
    dashboard: options.dashboard,
    onRefused: (error) => options.onRefused(instance.id, error),
    onRemoved: () => options.onRemoved?.(instance.id),
    ...(options.openChannel ? { openChannel: options.openChannel } : {}),
  });
  const openSocket = () => link.openSocket();
  const connection =
    options.createConnection?.(openSocket) ?? new Connection({ openSocket, retry: retryLater });
  return {
    id: instance.id,
    name: instance.name,
    current: device.onMachine === true,
    connection,
    fetch: (request) => link.fetch(request),
    close: () => {
      connection.stop();
      link.close();
    },
  } satisfies FleetMember;
}

export const TASK_CAPACITY_TITLE = 'Task capacity';

const NO_TASK_CAPACITY = 'none';

const TASK_CAPACITIES = [2, 4, 8, 16];

export function listTaskCapacityItems(current: number | null) {
  const values =
    current === null || TASK_CAPACITIES.includes(current)
      ? TASK_CAPACITIES
      : [...TASK_CAPACITIES, current].sort((a, b) => a - b);
  return [
    { value: NO_TASK_CAPACITY, label: 'No limit' },
    ...values.map((value) => ({ value: String(value), label: `Up to ${value} open tasks` })),
  ];
}

export function resolveTaskCapacityValue(capacity: number | null) {
  return capacity === null ? NO_TASK_CAPACITY : String(capacity);
}

export function parseTaskCapacity(value: string) {
  return value === NO_TASK_CAPACITY ? null : Number(value);
}
