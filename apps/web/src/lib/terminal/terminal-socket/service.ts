import { Context, Effect, Layer, Stream } from 'effect';
import { Socket } from 'effect/socket';
import { dialSocket } from '@/lib/runtime/socket/dial.ts';
import { keepDialing } from '@/lib/runtime/socket/reconnect.ts';
import {
  TERMINAL_FINAL_CODES,
  TERMINAL_RECONNECT,
  TERMINAL_SOCKET_PATH,
  type TerminalSession,
  TerminalSocketClosed,
} from './schema.ts';

export class TerminalSocket extends Context.Service<
  TerminalSocket,
  { connect(id: string, session: TerminalSession): Effect.Effect<void> }
>()('shinsa/web/terminal/terminal-socket/TerminalSocket') {
  static readonly layer = Layer.effect(
    TerminalSocket,
    Effect.gen(function* () {
      const makeWebSocket = yield* Socket.WebSocketConstructor;
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';

      const dial = Effect.fn('TerminalSocket.dial')(function* (url: string, session: TerminalSession) {
        let connected = false;
        const drop = (error: Socket.SocketError | null) =>
          Effect.suspend(() => {
            const final =
              error?.reason._tag === 'SocketCloseError' && TERMINAL_FINAL_CODES.has(error.reason.code);
            session.closed(final);
            return Effect.fail(new TerminalSocketClosed({ connected, final }));
          });
        const socket = yield* Effect.catchTag(dialSocket(url), 'SocketError', drop);
        connected = true;
        session.opened({ isOpen: socket.isOpen, send: socket.send });
        return yield* socket.frames.pipe(
          Stream.runForEach((frame) => Effect.sync(() => session.received(frame))),
          Effect.andThen(drop(null)),
          Effect.catchTag('SocketError', drop)
        );
      }, Effect.scoped);

      const connect = Effect.fn('TerminalSocket.connect')(
        function* (id: string, session: TerminalSession) {
          const url = `${scheme}://${location.host}${TERMINAL_SOCKET_PATH}${encodeURIComponent(id)}`;
          yield* keepDialing(dial(url, session), TERMINAL_RECONNECT);
        },
        Effect.provideService(Socket.WebSocketConstructor, makeWebSocket)
      );

      return TerminalSocket.of({ connect });
    })
  );
}
