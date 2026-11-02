import { Context, Effect, Layer, Option, Schema, Stream } from 'effect';
import { Socket } from 'effect/socket';
import {
  ClientMessageText,
  ENGINE_OPEN_TIMEOUT,
  ENGINE_RECONNECT,
  ENGINE_REDIAL,
  ENGINE_SOCKET_PATH,
  type EngineSession,
  EngineSocketClosed,
  ServerMessageText,
  WEB_SOCKET_OPEN,
} from './schema.ts';

export class EngineSocket extends Context.Service<
  EngineSocket,
  { connect(session: EngineSession): Effect.Effect<never> }
>()('shinsa/web/connection/engine-socket/EngineSocket') {
  static readonly layer = Layer.effect(
    EngineSocket,
    Effect.gen(function* () {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${scheme}://${location.host}${ENGINE_SOCKET_PATH}`;
      const makeWebSocket = yield* Socket.WebSocketConstructor;
      let dialed: Socket.WebSocketLike | null = null;
      const socket = yield* Socket.fromWebSocket(
        Effect.acquireRelease(
          Effect.sync(() => {
            dialed = makeWebSocket(url);
            return dialed;
          }),
          (webSocket) => Effect.sync(() => webSocket.close(1000))
        ),
        { openTimeout: ENGINE_OPEN_TIMEOUT }
      );
      const encode = Schema.encodeUnknownEffect(ClientMessageText);
      const decode = Schema.decodeUnknownOption(ServerMessageText);

      const dial = Effect.fn('EngineSocket.dial')(function* (session: EngineSession) {
        let synced = false;
        const closed = Effect.sync(() => {
          session.closed();
          return new EngineSocketClosed({ synced });
        });
        const pull = yield* Effect.catchTag(Socket.readerString(socket), 'SocketError', () =>
          Effect.flatMap(closed, Effect.fail)
        );
        const writer = yield* socket.writer;
        const webSocket = dialed;
        session.opened({
          isOpen: () => webSocket?.readyState === WEB_SOCKET_OPEN,
          send: (message) =>
            encode(message).pipe(
              Effect.orDie,
              Effect.flatMap(writer.write),
              Effect.catchTag('SocketError', () => Effect.void)
            ),
        });
        return yield* Stream.fromPull(Effect.succeed(pull)).pipe(
          Stream.runForEach((text) =>
            Effect.sync(() => {
              const message = decode(text);
              if (Option.isNone(message)) return;
              if (message.value.type === 'state') synced = true;
              session.received(message.value);
            })
          ),
          Effect.catchTag('SocketError', () => Effect.flatMap(closed, Effect.fail)),
          Effect.andThen(Effect.flatMap(closed, Effect.fail))
        );
      }, Effect.scoped);

      const connect = Effect.fn('EngineSocket.connect')(
        function* (session: EngineSession) {
          return yield* dial(session);
        },
        Effect.retry({ schedule: ENGINE_RECONNECT, while: (closed) => !closed.synced }),
        Effect.catchTag('EngineSocketClosed', () => Effect.sleep(ENGINE_REDIAL)),
        (cycle) => Effect.forever(cycle, { disableYield: true })
      );

      return EngineSocket.of({ connect });
    })
  );
}
