import { Schedule, Schema } from 'effect';

export const DEVICE_PREFIX = 'device:';

export const EnrolledDevice = Schema.Struct({
  instanceId: Schema.String,
  machineKey: Schema.String,
  keys: Schema.Struct({ privateKey: Schema.instanceOf(CryptoKey), publicKey: Schema.instanceOf(CryptoKey) }),
  enrolledAt: Schema.Number,
  onMachine: Schema.optionalKey(Schema.Literal(true)),
  waiting: Schema.optionalKey(
    Schema.Struct({ machineName: Schema.String, deviceName: Schema.optionalKey(Schema.String) })
  ),
});

export type EnrolledDevice = typeof EnrolledDevice.Type;

export interface KeyValueStore {
  read: (key: string) => Promise<unknown>;
  write: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
  listKeys: () => Promise<string[]>;
}

export const DEVICE_STORE_FAILED = 'This browser could not read the keys it keeps.';

export class DeviceStoreFailed extends Schema.TaggedError<
  DeviceStoreFailed,
  { readonly brand: unique symbol }
>()('DeviceStoreFailed', { message: Schema.String }) {}

export const ENROLL_RETRY = Schedule.spaced('2 seconds');

export class EnrollFailed extends Schema.TaggedError<EnrollFailed, { readonly brand: unique symbol }>()(
  'EnrollFailed',
  { message: Schema.String, refused: Schema.Boolean }
) {}

export interface EnrollInput {
  instanceId: string;
  machineKey: string;
  secret: string;
  invite: string;
  onMachine: boolean;
}

export type WaitingAnswer = 'accepted' | 'waiting' | 'declined';

export type ClaimStanding = { kind: 'ready' } | { kind: 'added' | 'busy'; machine: string };
