import type { RemoteInstance } from '@shinsa/core';
import { Connection, retryLater } from '@/lib/connection/socket.ts';
import { formatSince } from '@/lib/format/time.ts';
import type { ChannelError } from './channel.ts';
import type { DashboardClient } from './dashboard.ts';
import type { DeviceStore, EnrolledDevice } from './devices.ts';
import type { FleetMember } from './fleet.ts';
import { RemoteLink, type RemoteLinkOptions } from './link.ts';

export interface MachineRow {
  instance: RemoteInstance;
  device: EnrolledDevice | null;
  status: string;
  access: string;
}

export function describeMachine(
  instance: RemoteInstance,
  device: EnrolledDevice | null,
  now = Date.now()
): MachineRow {
  const seen =
    instance.lastSeenAt === null ? 'Never connected' : formatSince('Last seen', instance.lastSeenAt, now);
  return {
    instance,
    device,
    status: instance.online ? 'Online' : seen,
    access: device ? 'In this dashboard' : 'Not added in this browser',
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
  createConnection?: (openSocket: () => WebSocket) => FleetMember['connection'];
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
    ...(options.openChannel ? { openChannel: options.openChannel } : {}),
  });
  const openSocket = () => link.openSocket();
  const connection =
    options.createConnection?.(openSocket) ?? new Connection({ openSocket, retry: retryLater });
  const member: FleetMember = {
    id: instance.id,
    name: instance.name,
    connection,
    fetch: (request) => link.fetch(request),
  };
  return { member, close: () => link.close() };
}
