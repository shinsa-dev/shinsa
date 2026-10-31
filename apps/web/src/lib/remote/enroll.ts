import { ChannelError, type ChannelOptions, openRemoteChannel, type RemoteChannel } from './channel.ts';
import type { DashboardClient } from './dashboard.ts';
import { createDeviceKeys, type DeviceStore, type EnrolledDevice } from './devices.ts';

export interface EnrollInput {
  instanceId: string;
  machineKey: string;
  secret: string;
  invite: string | null;
  onMachine: boolean;
}

export interface EnrollOptions {
  dashboard: Pick<DashboardClient, 'requestConnect' | 'acceptInvite'>;
  devices: Pick<DeviceStore, 'writeDevice'>;
  name: string;
  onPending: () => void;
  now?: () => number;
  retryMs?: number;
  createKeys?: () => Promise<CryptoKeyPair>;
  openChannel?: (options: ChannelOptions) => Promise<RemoteChannel>;
}

async function resolveConnectUrl(input: EnrollInput, options: EnrollOptions) {
  if (input.invite) return (await options.dashboard.acceptInvite(input.invite)).connect.url;
  return (await options.dashboard.requestConnect(input.instanceId)).url;
}

const RETRY_MS = 2_000;

async function openWhenAccepted(input: EnrollInput, options: EnrollOptions, keys: CryptoKeyPair) {
  let pending = false;
  for (;;) {
    try {
      return await (options.openChannel ?? openRemoteChannel)({
        url: await resolveConnectUrl(input, options),
        machineKey: input.machineKey,
        device: keys,
        enrollSecret: input.secret,
        name: options.name,
        onPending: () => {
          pending = true;
          options.onPending();
        },
      });
    } catch (error) {
      if (!pending || (error instanceof ChannelError && error.refused)) throw error;
      await new Promise((resolve) => setTimeout(resolve, options.retryMs ?? RETRY_MS));
    }
  }
}

export async function requestDeviceAccess(
  input: EnrollInput,
  options: EnrollOptions
): Promise<EnrolledDevice> {
  const keys = await (options.createKeys ?? createDeviceKeys)();
  const channel = await openWhenAccepted(input, options, keys);
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
