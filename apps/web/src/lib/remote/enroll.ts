import type { RemoteInstance } from '@shinsa/core';
import { Clock, Effect, Predicate, type Schedule } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';
import { openRemoteChannel } from './channel.ts';
import type { DashboardClient } from './dashboard.ts';
import { createDeviceKeys, type DeviceStore } from './devices.ts';
import { ChannelError, type ChannelOptions, type RemoteChannel } from './remote-channel/schema.ts';
import {
  type ClaimStanding,
  ENROLL_RETRY,
  type EnrolledDevice,
  EnrollFailed,
  type EnrollInput,
  type WaitingAnswer,
} from './schema.ts';

export type { ClaimStanding, EnrollInput, WaitingAnswer } from './schema.ts';

export interface EnrollOptions {
  dashboard: Pick<DashboardClient, 'acceptInvite'>;
  devices: Pick<DeviceStore, 'writeDevice'>;
  name: string;
  earlier?: EnrolledDevice | null;
  onPending: () => void;
  now?: () => number;
  retry?: Schedule.Schedule<unknown>;
  createKeys?: () => Promise<CryptoKeyPair>;
  openChannel?: (options: ChannelOptions) => Promise<RemoteChannel>;
}

export interface WaitingOptions {
  dashboard: Pick<DashboardClient, 'requestConnect'>;
  devices: Pick<DeviceStore, 'writeDevice' | 'removeDevice'>;
  openChannel?: (options: ChannelOptions) => Promise<RemoteChannel>;
  openSocket: (url: string) => WebSocket;
}

export interface ClaimOptions {
  dashboard: Pick<DashboardClient, 'acceptHandoff'>;
  devices: Pick<DeviceStore, 'writeDevice'>;
  name: string;
  now?: () => number;
  createKeys?: () => Promise<CryptoKeyPair>;
  openChannel?: (options: ChannelOptions) => Promise<RemoteChannel>;
}

function enterStep<A>(step: () => Promise<A>) {
  return Effect.tryPromise({
    try: step,
    catch: (error) =>
      new EnrollFailed({
        message: Predicate.isError(error) ? error.message : String(error),
        refused: error instanceof ChannelError && error.refused === true,
      }),
  });
}

export function selectWaitingDevice(input: EnrollInput, device: EnrolledDevice | null) {
  return device?.waiting && device.machineKey === input.machineKey ? device : null;
}

export function requestDeviceAccess(input: EnrollInput, options: EnrollOptions): Promise<EnrolledDevice> {
  const openChannel = options.openChannel ?? openRemoteChannel;
  return runApp(
    Effect.gen(function* () {
      const earlier = selectWaitingDevice(input, options.earlier ?? null);
      const keys = earlier?.keys ?? (yield* enterStep(options.createKeys ?? createDeviceKeys));
      const enrolledAt = earlier?.enrolledAt ?? options.now?.() ?? (yield* Clock.currentTimeMillis);
      const device: EnrolledDevice = {
        instanceId: input.instanceId,
        machineKey: input.machineKey,
        keys,
        enrolledAt,
        ...(input.onMachine ? { onMachine: true as const } : {}),
      };
      let pending = false;
      const markPending = (machineName: string) => {
        if (!pending)
          void options.devices.writeDevice({
            ...device,
            waiting: { machineName, deviceName: options.name },
          });
        pending = true;
        options.onPending();
      };
      const open = Effect.gen(function* () {
        const accepted = yield* enterStep(() => options.dashboard.acceptInvite(input.invite));
        return yield* enterStep(() =>
          openChannel({
            url: accepted.connect.url,
            machineKey: input.machineKey,
            device: device.keys,
            enrollSecret: input.secret,
            name: options.name,
            onPending: () => markPending(accepted.name),
          })
        );
      });
      const channel = yield* Effect.retry(open, {
        schedule: options.retry ?? ENROLL_RETRY,
        while: (failure) => pending && !failure.refused,
      });
      channel.close();
      yield* enterStep(() => options.devices.writeDevice(device));
      return device;
    })
  );
}

export function requestWaitingAnswer(
  device: EnrolledDevice,
  options: WaitingOptions
): Promise<WaitingAnswer> {
  const openChannel = options.openChannel ?? openRemoteChannel;
  return runApp(
    Effect.gen(function* () {
      let socket: WebSocket | null = null;
      let pending = false;
      const accept = Effect.gen(function* () {
        const { url } = yield* enterStep(() => options.dashboard.requestConnect(device.instanceId));
        const channel = yield* enterStep(() =>
          openChannel({
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
          })
        );
        channel.close();
        const { waiting: _waiting, ...accepted } = device;
        yield* enterStep(() => options.devices.writeDevice(accepted));
        return 'accepted' as const;
      });
      return yield* Effect.catchTag(accept, 'EnrollFailed', (failure) => {
        if (pending || !failure.refused) return Effect.succeed('waiting' as const);
        return enterStep(() => options.devices.removeDevice(device.instanceId)).pipe(
          Effect.as('declined' as const)
        );
      });
    })
  );
}

export function claimHandoff(input: EnrollInput, options: ClaimOptions): Promise<EnrolledDevice> {
  const openChannel = options.openChannel ?? openRemoteChannel;
  return runApp(
    Effect.gen(function* () {
      const keys = yield* enterStep(options.createKeys ?? createDeviceKeys);
      const enrolledAt = options.now?.() ?? (yield* Clock.currentTimeMillis);
      const device: EnrolledDevice = {
        instanceId: input.instanceId,
        machineKey: input.machineKey,
        keys,
        enrolledAt,
      };
      const accepted = yield* enterStep(() => options.dashboard.acceptHandoff(input.invite));
      const channel = yield* enterStep(() =>
        openChannel({
          url: accepted.connect.url,
          machineKey: input.machineKey,
          device: device.keys,
          enrollSecret: input.secret,
          name: options.name,
        })
      );
      channel.close();
      yield* enterStep(() => options.devices.writeDevice(device));
      return device;
    })
  );
}

export function resolveClaimStanding(
  input: EnrollInput,
  instances: readonly RemoteInstance[],
  device: EnrolledDevice | null
): ClaimStanding {
  const instance = instances.find((entry) => entry.id === input.instanceId);
  if (!(instance && device && !device.waiting && device.machineKey === input.machineKey))
    return { kind: 'ready' };
  return { kind: instance.role === 'guest' ? 'busy' : 'added', machine: instance.name };
}
