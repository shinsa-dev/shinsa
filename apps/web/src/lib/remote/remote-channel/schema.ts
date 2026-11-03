import type { Bytes, ChannelHeaders, ChannelMessage } from '@shinsa/core';
import { type Deferred, type Effect, Schema } from 'effect';
import type { Socket } from 'effect/socket';

export const CHANNEL_CLOSED = 'The connection to your machine is closed.';

export const CHANNEL_CLOSED_HERE = 'The connection to your machine was closed on this page.';

export const CHANNEL_DROPPED = 'The connection to your machine closed.';

export const CHANNEL_BROKE = 'The connection to your machine broke.';

export const CHANNEL_UNREACHABLE = 'Couldn’t reach your machine.';

export const CHANNEL_KEY_INVALID = 'The key this browser pinned for your machine is not valid.';

export const CHANNEL_HANDSHAKE_MISSING = 'Your machine answered without a handshake.';

export const CHANNEL_HANDSHAKE_UNKNOWN = 'Your machine answered the handshake with something else.';

export const CHANNEL_UNSEALED = 'Your machine sent an unsealed message.';

export const CHANNEL_MESSAGE_UNKNOWN = 'Your machine sent a message this page does not know.';

export const CHANNEL_BROWSER_ONLY = 'Your machine sent a message only a browser sends.';

export const CHANNEL_UNANSWERED = 'Your machine ended a request without answering it.';

export const CHANNEL_REPLACED = 'A newer connection to your machine replaced this one.';

export const REQUEST_ABORTED = 'The request was aborted.';

export const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 103, 204, 205, 304]);

export class ChannelError extends Schema.TaggedError<ChannelError, { readonly brand: unique symbol }>()(
  'ChannelError',
  { message: Schema.String, refused: Schema.optionalKey(Schema.Boolean) }
) {}

export class RequestAborted extends Schema.TaggedError<RequestAborted, { readonly brand: unique symbol }>()(
  'RequestAborted',
  { message: Schema.String }
) {}

export type RequestFailure = ChannelError | RequestAborted;

export interface ChannelOptions {
  url: string | Promise<string>;
  machineKey: string;
  device: CryptoKeyPair;
  enrollSecret: string | null;
  name?: string | null;
  onPending?: () => void;
  openSocket?: (url: string) => Socket.WebSocketLike;
}

export interface ChannelRequest {
  method: string;
  path: string;
  headers: ChannelHeaders;
  body: Bytes | null;
  signal?: AbortSignal;
}

export interface ChannelHello {
  machinePublicKey: CryptoKey;
  ephemeral: CryptoKeyPair;
  device: string;
  clientEphemeral: string;
  hello: object;
}

export type TerminalStreamMessage = Extract<
  ChannelMessage,
  { t: 'terminal-text' | 'terminal-bytes' | 'terminal-close' }
>;

type TerminalSendMessage = TerminalStreamMessage | Extract<ChannelMessage, { t: 'terminal-open' }>;

export interface Outgoing {
  message: ChannelMessage;
  sent: Deferred.Deferred<void, ChannelError>;
}

export interface PendingResponse {
  answer: Deferred.Deferred<Response, RequestFailure>;
  stream: ReadableStreamDefaultController<Uint8Array> | null;
}

export interface ChannelLink {
  isOpen(): boolean;
  isClosed(): boolean;
  request(input: ChannelRequest): Effect.Effect<Response, RequestFailure>;
  sendSocket(data: string): Effect.Effect<void, ChannelError>;
  subscribeSocket(listener: (data: string) => void): () => void;
  sendTerminal(message: TerminalSendMessage): Effect.Effect<void, ChannelError>;
  subscribeTerminal(listener: (message: TerminalStreamMessage) => void): () => void;
  subscribeClose(listener: (error: ChannelError) => void): () => void;
  close(): void;
}

export interface RemoteChannel {
  readonly isOpen: boolean;
  readonly isClosed: boolean;
  request(input: ChannelRequest): Promise<Response>;
  sendSocket(data: string): Promise<void>;
  subscribeSocket(listener: (data: string) => void): () => void;
  sendTerminal(message: TerminalSendMessage): Promise<void>;
  subscribeTerminal(listener: (message: TerminalStreamMessage) => void): () => void;
  subscribeClose(listener: (error: ChannelError) => void): () => void;
  close(): void;
}
