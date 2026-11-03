import { Context, Effect, Layer, Option, Schema, Stream } from 'effect';
import { Socket } from 'effect/socket';
import { dialSocket } from '@/lib/runtime/socket/dial.ts';
import { keepDialing } from '@/lib/runtime/socket/reconnect.ts';
import {
  ClientMessageText,
  ENGINE_RECONNECT,
  ENGINE_SOCKET_PATH,
  type EngineSession,
  EngineSocketClosed,
  ServerMessageText,
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
      const encode = Schema.encodeUnknownEffect(ClientMessageText);
      const decode = Schema.decodeUnknownOption(ServerMessageText);

      const dial = Effect.fn('EngineSocket.dial')(function* (session: EngineSession) {
        let synced = false;
        const closed = Effect.suspend(() => {
          session.closed();
          return Effect.fail(new EngineSocketClosed({ connected: synced, final: false }));
        });
        const socket = yield* Effect.catchTag(dialSocket(url), 'SocketError', () => closed);
        session.opened({
          isOpen: socket.isOpen,
          send: (message) => encode(message).pipe(Effect.orDie, Effect.flatMap(socket.send)),
        });
        return yield* socket.frames.pipe(
          Stream.runForEach((frame) =>
            Effect.sync(() => {
              const message = decode(frame);
              if (Option.isNone(message)) return;
              if (message.value.type === 'state') synced = true;
              session.received(message.value);
            })
          ),
          Effect.andThen(closed),
          Effect.catchTag('SocketError', () => closed)
        );
      }, Effect.scoped);

      const connect = Effect.fn('EngineSocket.connect')(
        function* (session: EngineSession) {
          return yield* keepDialing(dial(session), ENGINE_RECONNECT).pipe(Effect.andThen(Effect.never));
        },
        Effect.provideService(Socket.WebSocketConstructor, makeWebSocket)
      );

      return EngineSocket.of({ connect });
    })
  );
}
