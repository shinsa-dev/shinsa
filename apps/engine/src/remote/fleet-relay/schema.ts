import type { Bytes } from '@shinsa/core';
import type { TeamRelayEntry } from '@shinsa/core/engine-api/schema';
import type { Effect } from 'effect';
import { ATTACHMENT_REQUEST_LIMIT_BYTES } from '../../store/attachments/schema.ts';
import type { ChannelPeer } from '../channel/schema.ts';

export const FLEET_RELAY_MESSAGES = {
  unknown: 'This machine does not reach that teammate’s machine.',
  unpaired: 'Remote access is off on this machine.',
  refused: 'That teammate’s machine does not let this machine in.',
} as const;

export const RELAY_CLOSE = { normal: 1000, refused: 4403, broke: 1011 } as const;

export const RELAY_DROPPED_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'content-length',
  'cookie',
  'host',
  'origin',
  'referer',
  'transfer-encoding',
  'upgrade',
]);

export const RELAY_BODY_LIMIT_BYTES = ATTACHMENT_REQUEST_LIMIT_BYTES;

export const RELAY_ABORTED_STATUS = 499;

export const RELAY_BODY_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RelayTarget {
  readonly teamId: string;
  readonly instanceId: string;
  readonly name: string;
  readonly userId: string;
  readonly machineKey: string;
  readonly grant: string | null;
}

export interface RelaySocket {
  receive(raw: string | Bytes): Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}

export interface OpenSocket {
  readonly instanceId: string;
  readonly end: Effect.Effect<void>;
}

export interface FleetRelayHandle {
  readonly list: Effect.Effect<TeamRelayEntry[]>;
  request(instanceId: string, path: string, request: Request): Effect.Effect<Response>;
  openSocket(instanceId: string, peer: ChannelPeer): Effect.Effect<RelaySocket>;
}
