import type { Duration, Effect, Layer, Schedule, Stream } from 'effect';
import type { NonEmptyReadonlyArray } from 'effect/Array';
import type { Socket } from 'effect/socket';

export const SOCKET_OPEN_TIMEOUT = '10 seconds';

export const WEB_SOCKET_OPEN = 1;

export const NORMAL_CLOSE = 1000;

export type SocketTransport = Layer.Layer<Socket.WebSocketConstructor>;

export type SocketFrame = string | Uint8Array<ArrayBuffer>;

export type SocketPull = Effect.Effect<NonEmptyReadonlyArray<SocketFrame>, Socket.SocketError>;

export interface DialedSocket {
  readonly frames: Stream.Stream<SocketFrame, Socket.SocketError>;
  isOpen(): boolean;
  send(frame: SocketFrame): Effect.Effect<void>;
}

export interface SocketDrop {
  readonly connected: boolean;
  readonly final: boolean;
}

export interface ReconnectPlan {
  readonly first: Schedule.Schedule<unknown, unknown>;
  readonly backoff: Schedule.Schedule<unknown, unknown>;
  readonly redial: Duration.Input;
}
