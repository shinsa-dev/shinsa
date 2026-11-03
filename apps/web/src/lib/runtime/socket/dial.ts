import { Effect, Stream } from 'effect';
import { Socket } from 'effect/socket';
import {
  type DialedSocket,
  NORMAL_CLOSE,
  SOCKET_OPEN_TIMEOUT,
  type SocketPull,
  WEB_SOCKET_OPEN,
} from './schema.ts';

export const dialSocket = Effect.fn('Socket.dial')(function* (url: string) {
  const makeWebSocket = yield* Socket.WebSocketConstructor;
  const dialed: { webSocket: Socket.WebSocketLike | null } = { webSocket: null };
  const socket = yield* Socket.fromWebSocket(
    Effect.acquireRelease(
      Effect.sync(() => {
        dialed.webSocket = makeWebSocket(url);
        return dialed.webSocket;
      }),
      (webSocket) => Effect.sync(() => webSocket.close(NORMAL_CLOSE))
    ),
    { openTimeout: SOCKET_OPEN_TIMEOUT }
  );
  const reader = yield* socket.reader;
  const writer = yield* socket.writer;
  const { webSocket } = dialed;
  const dialedSocket: DialedSocket = {
    frames: Stream.fromPull(Effect.succeed(reader.pull as SocketPull)),
    isOpen: () => webSocket?.readyState === WEB_SOCKET_OPEN,
    send: (frame) => Effect.catchTag(writer.write(frame), 'SocketError', () => Effect.void),
  };
  return dialedSocket;
});
