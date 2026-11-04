import { parseTerminalClientFrame } from '@shinsa/core';
import type { ServerWebSocket } from 'bun';
import { Effect } from 'effect';
import {
  SOCKET_CLOSED,
  TERMINAL_SOCKET_PATH,
  type TerminalSocketData,
  type TerminalViewer,
} from './schema.ts';
import type { Terminals } from './service.ts';

export function readTerminalSocketId(pathname: string) {
  return TERMINAL_SOCKET_PATH.exec(pathname)?.[1] ?? null;
}

type TerminalSocket = ServerWebSocket<TerminalSocketData>;

export const createTerminalSockets = Effect.fn('TerminalSockets.create')(function* (
  terminals: Terminals['Service']
) {
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());
  const select = (socket: TerminalSocket) => runSync(terminals.select(socket.data.terminalId));
  return {
    open(socket: TerminalSocket) {
      const session = select(socket);
      if (!session) {
        socket.close(SOCKET_CLOSED, 'That terminal is closed.');
        return;
      }
      const viewer: TerminalViewer = {
        send: (data) => socket.send(data),
        buffered: () => socket.getBufferedAmount(),
        end: () => socket.close(SOCKET_CLOSED, 'That terminal is closed.'),
      };
      socket.data.viewer = viewer;
      session.attach(viewer);
    },
    message(socket: TerminalSocket, raw: string | Buffer) {
      const session = select(socket);
      if (!session) return;
      if (typeof raw !== 'string') {
        session.input(new Uint8Array(raw));
        return;
      }
      const frame = parseTerminalClientFrame(raw);
      if (frame?.type === 'resize') session.resize(frame.cols, frame.rows);
      if (frame?.type === 'colors') session.replaceColors(frame.colors);
      if (frame?.type === 'clear') session.clear();
    },
    drain(socket: TerminalSocket) {
      const { viewer } = socket.data;
      if (viewer) select(socket)?.drain(viewer);
    },
    close(socket: TerminalSocket) {
      const { viewer } = socket.data;
      if (viewer) select(socket)?.detach(viewer);
      socket.data.viewer = null;
    },
  };
});
