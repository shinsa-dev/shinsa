import { type Bytes, RELAY_MAX_MESSAGE_BYTES, type RelayOpen } from '@shinsa/core';
import {
  Context,
  type Duration,
  type Effect,
  type Fiber,
  type Layer,
  type Queue,
  type Redacted,
  Schema,
  type Scope,
} from 'effect';
import type { Socket } from 'effect/socket';
import type { RelayConnector } from './service.ts';

export const RELAY_UNKNOWN_ADDRESS = '0.0.0.0';

export const RELAY_FORWARDED_HEADER = 'cf-connecting-ip';

export const RELAY_PROTOCOL_HEADER = 'sec-websocket-protocol';

export const RELAY_SENDABLE_CLOSE = { min: 1000, max: 4999, reserved: new Set([1004, 1005, 1006, 1015]) };

export const RELAY_STREAM_FAILED = 1011;

export const RELAY_BODILESS_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

export const RELAY_DROPPED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  'host',
  'connection',
  'keep-alive',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
  'sec-websocket-protocol',
  RELAY_FORWARDED_HEADER,
]);

export const RELAY_DROPPED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'content-length',
  'transfer-encoding',
]);

export const RELAY_MESSAGES = {
  refused: 'The relay refused this machine.',
  busy: 'This machine has too many open streams.',
  tooLarge: 'The message is too large.',
  unanswered: 'The engine did not answer.',
  dropped: 'The relay connection closed.',
} as const;

export interface RelayLimitSettings {
  readonly connectTimeout: Duration.Input;
  readonly pingTimeout: Duration.Input;
  readonly dialTimeout: Duration.Input;
  readonly requestBodyBytes: number;
  readonly messageBytes: number;
}

export const RelayLimits = Context.Reference<RelayLimitSettings>('shinsa/engine/remote/relay/RelayLimits', {
  defaultValue: () => ({
    connectTimeout: '30 seconds',
    pingTimeout: '10 seconds',
    dialTimeout: '10 seconds',
    requestBodyBytes: 32 * 1024 * 1024,
    messageBytes: RELAY_MAX_MESSAGE_BYTES,
  }),
});

export const RelayFetch = Context.Reference<typeof fetch>('shinsa/engine/remote/relay/RelayFetch', {
  defaultValue: () => fetch,
});

export class RelayConnectFailed extends Schema.TaggedError<
  RelayConnectFailed,
  { readonly brand: unique symbol }
>()('RelayConnectFailed', { message: Schema.String, status: Schema.NullOr(Schema.Int) }) {}

export class RelayDialFailed extends Schema.TaggedError<RelayDialFailed, { readonly brand: unique symbol }>()(
  'RelayDialFailed',
  { message: Schema.String }
) {}

export interface RelayTarget {
  readonly instanceId: string;
  readonly machineToken: Redacted.Redacted<string>;
  readonly localUrl: string;
}

export interface RelayLink {
  readonly closed: Effect.Effect<string>;
  readonly ping: Effect.Effect<boolean>;
}

export type OpenRelay = (target: RelayTarget) => Effect.Effect<RelayLink, RelayConnectFailed, Scope.Scope>;

export type RelayConnectorLayer = Layer.Layer<RelayConnector>;

export type RelayInbound = string | Bytes | Socket.CloseEvent;

export type RelayStream =
  | {
      readonly kind: 'http';
      readonly open: RelayOpen;
      readonly chunks: Bytes[];
      size: number;
      fiber: Fiber.Fiber<void> | null;
    }
  | {
      readonly kind: 'socket';
      readonly inbox: Queue.Queue<RelayInbound>;
    };
