import type { Bytes, ChannelHeaders, ChannelMessage } from '@shinsa/core';
import { type Deferred, type Effect, Schema } from 'effect';

export const DEVICE_CHANNEL_OPEN_TIMEOUT = '10 seconds';

export const DEVICE_CHANNEL_MESSAGES = {
  closed: 'The channel to that machine is closed.',
  closedHere: 'This machine closed its channel to that machine.',
  dropped: 'The channel to that machine closed.',
  broke: 'The channel to that machine broke.',
  unreachable: 'That machine could not be reached.',
  keyInvalid: 'The key kept for that machine is not valid.',
  handshakeMissing: 'That machine answered without a handshake.',
  handshakeUnknown: 'That machine answered the handshake with something else.',
  unsealed: 'That machine sent an unsealed message.',
  unknown: 'That machine sent a message this machine does not know.',
  clientOnly: 'That machine sent a message only a client sends.',
  unanswered: 'That machine ended a request without answering it.',
  aborted: 'The request was aborted.',
} as const;

export const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 103, 204, 205, 304]);

export class DeviceChannelError extends Schema.TaggedError<
  DeviceChannelError,
  { readonly brand: unique symbol }
>()('DeviceChannelError', { message: Schema.String, refused: Schema.Boolean }) {}

export class DeviceRequestAborted extends Schema.TaggedError<
  DeviceRequestAborted,
  { readonly brand: unique symbol }
>()('DeviceRequestAborted', { message: Schema.String }) {}

export type DeviceRequestFailure = DeviceChannelError | DeviceRequestAborted;

export interface DeviceChannelOptions {
  readonly url: string;
  readonly origin: string;
  readonly machineKey: string;
  readonly device: CryptoKeyPair;
  readonly enrollSecret: string | null;
  readonly name: string | null;
}

export interface DeviceChannelRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: ChannelHeaders;
  readonly body: Bytes | null;
  readonly signal?: AbortSignal;
}

export interface DeviceChannelLink {
  readonly isOpen: Effect.Effect<boolean>;
  request(input: DeviceChannelRequest): Effect.Effect<Response, DeviceRequestFailure>;
  sendSocket(data: string): Effect.Effect<void, DeviceChannelError>;
  subscribeSocket(listener: (data: string) => void): () => void;
  subscribeClose(listener: (error: DeviceChannelError) => void): () => void;
  readonly close: Effect.Effect<void>;
}

export interface DeviceChannelsShape {
  open(options: DeviceChannelOptions): Effect.Effect<DeviceChannelLink, DeviceChannelError>;
}

export interface DeviceHello {
  readonly machinePublicKey: CryptoKey;
  readonly ephemeral: CryptoKeyPair;
  readonly device: string;
  readonly clientEphemeral: string;
  readonly hello: object;
}

export interface DeviceOutgoing {
  readonly message: ChannelMessage;
  readonly sent: Deferred.Deferred<void, DeviceChannelError>;
}

export interface DevicePending {
  readonly answer: Deferred.Deferred<Response, DeviceRequestFailure>;
  stream: ReadableStreamDefaultController<Uint8Array> | null;
}

export type DeviceFrame = string | Uint8Array;
