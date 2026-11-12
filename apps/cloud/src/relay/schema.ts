import type { Bytes } from '@shinsa/core';
import { Duration, type Effect, Schema } from 'effect';

export const RELAY_ROOM_ORIGIN = 'https://relay.internal';

export const RELAY_ROLE_HEADER = 'x-shinsa-relay-role';

export const RELAY_ADDRESS_HEADER = 'x-shinsa-relay-address';

export const RelayRole = Schema.Literals(['machine', 'socket', 'http', 'evict']);

export type RelayRole = typeof RelayRole.Type;

export const RELAY_RESPONSE_TIMEOUT = Duration.seconds(60);

export const RELAY_INTERNAL_HEADERS: ReadonlySet<string> = new Set([RELAY_ROLE_HEADER, RELAY_ADDRESS_HEADER]);

export const RELAY_HANDSHAKE_HEADERS: ReadonlySet<string> = new Set([
  'upgrade',
  'connection',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
]);

export const BODILESS_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

export const RELAY_REFUSALS = {
  offline: { status: 503, text: 'This machine is not connected.' },
  busy: { status: 503, text: 'This machine has too many open streams.' },
  dropped: { status: 502, text: 'The machine dropped the request.' },
  timeout: { status: 504, text: 'The machine did not answer in time.' },
  unknown: { status: 400, text: 'The relay does not know this request.' },
} as const;

export type RelayRefusal = keyof typeof RELAY_REFUSALS;

export const RELAY_CLOSE_REASONS = {
  replaced: 'The machine connected again.',
  removed: 'This machine was removed.',
  machineGone: 'The machine disconnected.',
  tooLarge: 'The message is too large.',
  cancelled: 'The request was cancelled.',
} as const;

export type RelayTag = { readonly role: 'machine' } | { readonly role: 'browser'; readonly stream: number };

export interface RelayPeer {
  readonly tag: RelayTag;
  readonly send: (message: string | Bytes) => void;
  readonly close: (code: number, reason: string) => void;
}

export interface RelayRoom {
  readonly listPeers: () => ReadonlyArray<RelayPeer>;
  readonly accept: (tag: RelayTag, protocol: string | null) => Response;
}

export interface RelayHub {
  readonly fetch: (request: Request) => Effect.Effect<Response>;
  readonly receive: (peer: RelayPeer, message: string | ArrayBuffer) => Effect.Effect<void>;
  readonly closed: (peer: RelayPeer, code: number, reason: string) => Effect.Effect<void>;
}

export class RelayBodyBroken extends Schema.TaggedError<RelayBodyBroken, { readonly brand: unique symbol }>()(
  'RelayBodyBroken',
  {
    message: Schema.String,
  }
) {}
