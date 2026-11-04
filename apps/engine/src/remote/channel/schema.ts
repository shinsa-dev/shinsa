import type { Bytes, ChannelHeaders, GuestActor, HandshakeKeys } from '@shinsa/core';
import { type Effect, Schema } from 'effect';
import type { HubSocket } from '../../http/socket.ts';
import type { MachineKeyPair } from '../pairing/schema.ts';

export const CHANNEL_REQUEST_ORIGIN = 'http://remote.shinsa.internal';

export const MAX_OPEN_REQUESTS = 32;

export const MAX_INFLATED_FRAME_BYTES = 64 * 1024 * 1024;

export const DROPPED = 0;

export const DROPPED_HEADERS: ReadonlySet<string> = new Set([
  'host',
  'connection',
  'cookie',
  'origin',
  'content-length',
  'upgrade',
]);

export class ChannelBroken extends Schema.TaggedError<ChannelBroken, { readonly brand: unique symbol }>()(
  'ChannelBroken',
  { message: Schema.String }
) {}

export type ChannelRaw = string | Bytes | ArrayBuffer | Uint8Array;

export type ProofKeys = Pick<HandshakeKeys, 'machine' | 'device' | 'clientEphemeral'>;

export interface ChannelPeer {
  send: (data: string | Bytes) => unknown;
  close: (code: number, reason: string) => void;
}

export interface ChannelHub {
  open: (socket: HubSocket) => void;
  close: (socket: HubSocket) => void;
  message: (socket: HubSocket, raw: string) => void;
}

export type AccessAnswer =
  | { kind: 'refused'; reason: string }
  | { kind: 'admitted' }
  | { kind: 'waiting'; decided: Effect.Effect<boolean> };

export interface ChannelDefinition {
  readonly send: (data: string | Bytes) => Effect.Effect<unknown>;
  readonly closePeer: (code: number, reason: string) => Effect.Effect<void>;
  readonly machineKey: Effect.Effect<MachineKeyPair, ChannelBroken>;
  readonly isEnrolled: (device: string) => Effect.Effect<boolean>;
  readonly resolveGuest: (device: string) => Effect.Effect<GuestActor | null>;
  readonly requestAccess: (
    proof: string,
    keys: ProofKeys,
    name: string | null
  ) => Effect.Effect<AccessAnswer, ChannelBroken>;
  readonly resumeAccess: (device: string) => Effect.Effect<AccessAnswer | null>;
  readonly recordSeen: (device: string) => Effect.Effect<void>;
  readonly openSocket: (socket: HubSocket) => Effect.Effect<void>;
  readonly closeSocket: (socket: HubSocket) => Effect.Effect<void>;
  readonly receiveSocket: (socket: HubSocket, raw: string) => Effect.Effect<void>;
  readonly respond: (request: Request, guest: GuestActor | null) => Effect.Effect<Response, ChannelBroken>;
  readonly maxBodyBytes: number;
}

export interface RemoteChannelHandle {
  readonly device: Effect.Effect<string | null>;
  readonly isOpen: Effect.Effect<boolean>;
  receive(raw: ChannelRaw): Effect.Effect<void>;
  fail(reason: string, error?: string): Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}

export interface OpenRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: ChannelHeaders;
  readonly chunks: readonly Bytes[];
  readonly size: number;
  readonly controller: AbortController;
  readonly sent: boolean;
  readonly guest: GuestActor | null;
}

export type ChannelState =
  | { readonly kind: 'hello' }
  | {
      readonly kind: 'open';
      readonly device: string;
      readonly guest: GuestActor | null;
      readonly seal: (plain: Bytes) => Promise<Bytes>;
      readonly open: (frame: Bytes) => Promise<Bytes>;
      readonly socket: HubSocket | null;
    }
  | { readonly kind: 'closed' };
