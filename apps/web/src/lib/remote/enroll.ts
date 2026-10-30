import { type ChannelOptions, openRemoteChannel, type RemoteChannel } from './channel.ts';
import type { DashboardClient } from './dashboard.ts';
import { createDeviceKeys, type DeviceStore, type EnrolledDevice } from './devices.ts';

export interface EnrollInput {
  instanceId: string;
  machineKey: string;
  secret: string;
  onMachine: boolean;
}

export interface EnrollOptions {
  dashboard: Pick<DashboardClient, 'requestConnect'>;
  devices: Pick<DeviceStore, 'writeDevice'>;
  now?: () => number;
  createKeys?: () => Promise<CryptoKeyPair>;
  openChannel?: (options: ChannelOptions) => Promise<RemoteChannel>;
}

export async function enrollDevice(input: EnrollInput, options: EnrollOptions): Promise<EnrolledDevice> {
  const keys = await (options.createKeys ?? createDeviceKeys)();
  const { url } = await options.dashboard.requestConnect(input.instanceId);
  const channel = await (options.openChannel ?? openRemoteChannel)({
    url,
    machineKey: input.machineKey,
    device: keys,
    enrollSecret: input.secret,
  });
  channel.close();
  const device: EnrolledDevice = {
    instanceId: input.instanceId,
    machineKey: input.machineKey,
    keys,
    enrolledAt: (options.now ?? Date.now)(),
    ...(input.onMachine ? { onMachine: true } : {}),
  };
  await options.devices.writeDevice(device);
  return device;
}
