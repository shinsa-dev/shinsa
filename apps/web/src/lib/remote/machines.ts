import { type AccessScopes, type RemoteInstance, resolveMachineLoad, type Task } from '@shinsa/core';
import { Connection, type MachineChoice, resolveSocketTransport } from '@/lib/connection/socket.ts';
import { formatSince } from '@/lib/format/time.ts';
import { describeMachineLoad } from '@/lib/new-task.ts';
import type { SocketTransport } from '@/lib/runtime/socket/schema.ts';
import type { DashboardClient } from './dashboard.ts';
import type { DeviceStore } from './devices.ts';
import type { FleetMember } from './fleet.ts';
import { RemoteLink, type RemoteLinkOptions } from './link.ts';
import { resolveMachineLabel } from './mode.ts';
import type { ChannelError } from './remote-channel/schema.ts';
import type { EnrolledDevice } from './schema.ts';
import type { Mention } from './users.ts';

export interface MachineRow {
  instance: RemoteInstance;
  device: EnrolledDevice | null;
  label: string;
  status: string;
  access: Mention;
}

function resolveDeviceAccess(device: EnrolledDevice | null) {
  if (!device) return 'Not added on this device';
  return device.waiting ? 'Waiting for an answer' : 'In this dashboard';
}

const SHARER: Record<Exclude<RemoteInstance['role'], 'owner'>, string> = {
  member: 'Shared by',
  guest: 'A task handed to you by',
  teammate: 'In a team with',
};

export function describeMachine(
  instance: RemoteInstance,
  device: EnrolledDevice | null,
  now = Date.now()
): MachineRow {
  const seen =
    instance.lastSeenAt === null ? 'Never connected' : formatSince('Last seen', instance.lastSeenAt, now);
  const current = device?.onMachine === true;
  const added = resolveDeviceAccess(device);
  const access: Mention =
    instance.role === 'owner'
      ? [added]
      : [`${SHARER[instance.role]} `, { user: instance.owner }, ` · ${added}`];
  return {
    instance,
    device,
    label: resolveMachineLabel({ name: instance.name, current }),
    status: instance.online ? 'Online' : seen,
    access: current ? [`${instance.name} · `, ...access] : access,
  };
}

export function resolveMachineDetail(
  row: MachineRow,
  machine: MachineChoice | undefined,
  handed: MachineChoice | undefined,
  tasks: Readonly<Record<string, Pick<Task, 'title'>>> = {}
): Mention {
  if (machine) return [...row.access, ` · ${describeMachineLoad(resolveMachineLoad(machine))}`];
  if (row.instance.role !== 'guest') return row.access;
  const titles = Object.keys(handed?.state.tasks ?? {}).flatMap((id) => {
    const title = tasks[id]?.title;
    return title ? [title] : [];
  });
  return titles.length > 0 ? [...row.access, ` · ${titles.join(', ')}`] : row.access;
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
  viewerId: string;
  teammateScopes?: AccessScopes;
  onRefused: (instanceId: string, error: ChannelError) => void;
  onRemoved?: (instanceId: string) => void;
  createConnection?: (transport: SocketTransport) => Connection;
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
  const transport = resolveSocketTransport(() => link.openSocket());
  const connection = options.createConnection?.(transport) ?? new Connection({ transport });
  return {
    id: instance.id,
    name: instance.name,
    current: device.onMachine === true,
    online: instance.online,
    ...(instance.role === 'guest' ? { guest: true as const, handedBy: instance.owner } : {}),
    ...(instance.role === 'teammate'
      ? {
          teammate: {
            owner: instance.owner,
            viewerId: options.viewerId,
            scopes: options.teammateScopes ?? [],
          },
        }
      : {}),
    connection,
    fetch: (request) => link.fetch(request),
    ...(instance.role === 'owner'
      ? { openTerminal: (terminalId: string) => link.openTerminalSocket(terminalId) }
      : {}),
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
