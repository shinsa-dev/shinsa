import { type ClientMessage, DomainError, type ServerMessage } from '@shinsa/core';
import type { ServerWebSocket } from 'bun';
import type { Transcripts } from '../agents/transcripts/index.ts';
import { describeError, log } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import { dispatchUserCommand } from './routes.ts';

export interface SocketData {
  transcripts: Map<string, () => void>;
}

type Socket = ServerWebSocket<SocketData>;

function send(socket: Socket, message: ServerMessage) {
  socket.send(JSON.stringify(message));
}

function parseClientMessage(raw: string | Buffer): ClientMessage | null {
  try {
    const message = JSON.parse(String(raw)) as unknown;
    if (!message || typeof message !== 'object' || typeof (message as { type?: unknown }).type !== 'string') {
      return null;
    }
    return message as ClientMessage;
  } catch {
    return null;
  }
}

export function createSocketHub(engine: Engine, transcripts: Transcripts) {
  const sockets = new Set<Socket>();

  const unsubscribeState = engine.subscribe((state) => {
    const payload = JSON.stringify({ type: 'state', state } satisfies ServerMessage);
    for (const socket of sockets) socket.send(payload);
  });

  const unsubscribeTranscripts = transcripts.subscribe((runId, entries) => {
    const payload = JSON.stringify({
      type: 'transcript',
      runId,
      entries,
      reset: false,
    } satisfies ServerMessage);
    for (const socket of sockets) {
      if (socket.data.transcripts.has(runId)) socket.send(payload);
    }
  });

  async function handleMessage(socket: Socket, message: ClientMessage) {
    switch (message.type) {
      case 'command': {
        try {
          await dispatchUserCommand(engine, message.command);
          send(socket, { type: 'ack', id: message.id, error: null });
        } catch (error) {
          const code = error instanceof DomainError ? error.code : 'command_failed';
          send(socket, { type: 'ack', id: message.id, error: { code, message: describeError(error) } });
        }
        return;
      }
      case 'transcript.subscribe':
        if (!socket.data.transcripts.has(message.runId)) {
          socket.data.transcripts.set(message.runId, transcripts.follow(message.runId));
        }
        send(socket, {
          type: 'transcript',
          runId: message.runId,
          entries: transcripts.listEntries(message.runId),
          reset: true,
        });
        return;
      case 'transcript.unsubscribe':
        socket.data.transcripts.get(message.runId)?.();
        socket.data.transcripts.delete(message.runId);
        return;
    }
  }

  return {
    open(socket: Socket) {
      sockets.add(socket);
      send(socket, { type: 'state', state: engine.state });
    },
    close(socket: Socket) {
      sockets.delete(socket);
      for (const unfollow of socket.data.transcripts.values()) unfollow();
      socket.data.transcripts.clear();
    },
    message(socket: Socket, raw: string | Buffer) {
      const message = parseClientMessage(raw);
      if (!message) {
        log.warn('[Socket] Ignored a message that is not a Shinsa message');
        return;
      }
      handleMessage(socket, message).catch((error: unknown) => {
        log.error('[Socket] Message failed', { type: message.type, error: describeError(error) });
      });
    },
    stop() {
      unsubscribeState();
      unsubscribeTranscripts();
    },
  };
}
