import { ClientMessage, ServerMessage } from '@shinsa/core';
import { type Effect, Schedule, Schema } from 'effect';
import type { ReconnectPlan } from '@/lib/runtime/socket/schema.ts';

export const ENGINE_SOCKET_PATH = '/ws';

const ENGINE_REDIAL = '250 millis';

const ENGINE_BACKOFF = Schedule.duration('1 second').pipe(
  Schedule.concat(Schedule.duration('2 seconds')),
  Schedule.concat(Schedule.spaced('5 seconds'))
);

export const ENGINE_RECONNECT: ReconnectPlan = {
  first: Schedule.duration(ENGINE_REDIAL).pipe(Schedule.concat(ENGINE_BACKOFF)),
  backoff: ENGINE_BACKOFF,
  redial: ENGINE_REDIAL,
};

export const ClientMessageText = Schema.fromJsonString(ClientMessage);

export const ServerMessageText = Schema.fromJsonString(ServerMessage);

export const NOT_CONNECTED_MESSAGE = 'Not connected to Shinsa.';

export const CONNECTION_LOST_MESSAGE = 'Lost the connection to Shinsa.';

export const UPDATE_ENGINE_MESSAGE = 'Update Shinsa to use this.';

export class CommandRefused extends Schema.TaggedError<CommandRefused, { readonly brand: unique symbol }>()(
  'CommandRefused',
  { code: Schema.String, message: Schema.String }
) {}

export class EngineSocketClosed extends Schema.TaggedError<
  EngineSocketClosed,
  { readonly brand: unique symbol }
>()('EngineSocketClosed', { connected: Schema.Boolean, final: Schema.Boolean }) {}

export interface EngineLink {
  isOpen(): boolean;
  send(message: ClientMessage): Effect.Effect<void>;
}

export interface EngineSession {
  opened(link: EngineLink): void;
  received(message: ServerMessage): void;
  closed(): void;
}
