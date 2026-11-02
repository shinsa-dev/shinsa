import { ClientMessage, ServerMessage } from '@shinsa/core';
import { type Effect, type Layer, Schedule, Schema } from 'effect';
import type { Socket } from 'effect/socket';

export const ENGINE_SOCKET_PATH = '/ws';

export const ENGINE_OPEN_TIMEOUT = '10 seconds';

export const ENGINE_REDIAL = '250 millis';

export const ENGINE_RECONNECT = Schedule.duration(ENGINE_REDIAL).pipe(
  Schedule.concat(Schedule.duration('1 second')),
  Schedule.concat(Schedule.duration('2 seconds')),
  Schedule.concat(Schedule.spaced('5 seconds'))
);

export const ClientMessageText = Schema.fromJsonString(ClientMessage);

export const ServerMessageText = Schema.fromJsonString(ServerMessage);

export const NOT_CONNECTED_MESSAGE = 'Not connected to Shinsa.';

export const CONNECTION_LOST_MESSAGE = 'Lost the connection to Shinsa.';

export const UPDATE_ENGINE_MESSAGE = 'Update Shinsa to use this.';

export class CommandRefused extends Schema.TaggedError<CommandRefused, { readonly brand: unique symbol }>()(
  'CommandRefused',
  { code: Schema.String, message: Schema.String }
) {}

export type SocketTransport = Layer.Layer<Socket.WebSocketConstructor>;

export class EngineSocketClosed extends Schema.TaggedError<
  EngineSocketClosed,
  { readonly brand: unique symbol }
>()('EngineSocketClosed', { synced: Schema.Boolean }) {}

export const WEB_SOCKET_OPEN = 1;

export interface EngineLink {
  isOpen(): boolean;
  send(message: ClientMessage): Effect.Effect<void>;
}

export interface EngineSession {
  opened(link: EngineLink): void;
  received(message: ServerMessage): void;
  closed(): void;
}
