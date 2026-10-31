import { ChannelError, type ChannelOptions, openRemoteChannel, type RemoteChannel } from './channel.ts';
import type { DashboardClient } from './dashboard.ts';
import { createDeviceKeys, type DeviceStore, type EnrolledDevice } from './devices.ts';

export interface EnrollInput {
  instanceId: string;
  machineKey: string;
  secret: string;
  invite: string;
  onMachine: boolean;
}

export interface EnrollOptions {
  dashboard: Pick<DashboardClient, 'acceptInvite'>;
  devices: Pick<DeviceStore, 'writeDevice'>;
  name: string;
  earlier?: EnrolledDevice | null;
  onPending: () => void;
  now?: () => number;
  retryMs?: number;
  createKeys?: () => Promise<CryptoKeyPair>;
  openChannel?: (options: ChannelOptions) => Promise<RemoteChannel>;
}

const RETRY_MS = 2_000;

async function openWhenAccepted(
  input: EnrollInput,
  options: EnrollOptions,
  device: EnrolledDevice
): Promise<RemoteChannel> {
  let pending = false;
  for (;;) {
    try {
      const accepted = await options.dashboard.acceptInvite(input.invite);
      return await (options.openChannel ?? openRemoteChannel)({
        url: accepted.connect.url,
        machineKey: input.machineKey,
        device: device.keys,
        enrollSecret: input.secret,
        name: options.name,
        onPending: () => {
          if (!pending)
            void options.devices.writeDevice({
              ...device,
              waiting: { machineName: accepted.name, deviceName: options.name },
            });
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

export function selectWaitingDevice(input: EnrollInput, device: EnrolledDevice | null) {
  return device?.waiting && device.machineKey === input.machineKey ? device : null;
}

export async function requestDeviceAccess(
  input: EnrollInput,
  options: EnrollOptions
): Promise<EnrolledDevice> {
  const earlier = selectWaitingDevice(input, options.earlier ?? null);
  const device: EnrolledDevice = {
    instanceId: input.instanceId,
    machineKey: input.machineKey,
    keys: earlier?.keys ?? (await (options.createKeys ?? createDeviceKeys)()),
    enrolledAt: earlier?.enrolledAt ?? (options.now ?? Date.now)(),
    ...(input.onMachine ? { onMachine: true } : {}),
  };
  const channel = await openWhenAccepted(input, options, device);
  channel.close();
  await options.devices.writeDevice(device);
  return device;
}

export type WaitingAnswer = 'accepted' | 'waiting' | 'declined';

export interface WaitingOptions {
  dashboard: Pick<DashboardClient, 'requestConnect'>;
  devices: Pick<DeviceStore, 'writeDevice' | 'removeDevice'>;
  openChannel?: (options: ChannelOptions) => Promise<RemoteChannel>;
  openSocket: (url: string) => WebSocket;
}

export async function requestWaitingAnswer(
  device: EnrolledDevice,
  options: WaitingOptions
): Promise<WaitingAnswer> {
  let socket: WebSocket | null = null;
  let pending = false;
  try {
    const { url } = await options.dashboard.requestConnect(device.instanceId);
    const channel = await (options.openChannel ?? openRemoteChannel)({
      url,
      machineKey: device.machineKey,
      device: device.keys,
      enrollSecret: null,
      openSocket: (target) => {
        socket = options.openSocket(target);
        return socket;
      },
      onPending: () => {
        pending = true;
        socket?.close();
      },
    });
    channel.close();
    const { waiting: _waiting, ...accepted } = device;
    await options.devices.writeDevice(accepted);
    return 'accepted';
  } catch (error) {
    if (pending || !(error instanceof ChannelError && error.refused)) return 'waiting';
    await options.devices.removeDevice(device.instanceId);
    return 'declined';
  }
}
