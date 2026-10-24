import { type ClientMessage, DomainError, type ServerMessage, type UserCommand } from '@shinsa/core';
import type { ServerWebSocket } from 'bun';
import type { Accounts } from '../accounts/index.ts';
import type { Transcripts } from '../agents/transcripts/index.ts';
import { describeError, log } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { MessageClassifier } from '../triage/message.ts';
import { dispatchUserCommand } from './routes.ts';

export interface SocketData {
  transcripts: Map<string, () => void>;
}

type Socket = ServerWebSocket<SocketData>;

function send(socket: Socket, message: ServerMessage) {
  socket.send(JSON.stringify(message));
}

const MAX_ID = 200;

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID;
}

function parseClientMessage(raw: string | Buffer): ClientMessage | null {
  let message: unknown;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return null;
  }
  if (!message || typeof message !== 'object') return null;
  const fields = message as { type?: unknown; id?: unknown; runId?: unknown; command?: unknown };
  if (fields.type === 'command' && isId(fields.id)) {
    return { type: 'command', id: fields.id, command: fields.command as UserCommand };
  }
  if (
    (fields.type === 'transcript.subscribe' || fields.type === 'transcript.unsubscribe') &&
    isId(fields.runId)
  ) {
    return { type: fields.type, runId: fields.runId };
  }
  return null;
}

export function createSocketHub(
  engine: Engine,
  transcripts: Transcripts,
  accounts?: Accounts,
  classify: MessageClassifier | null = null
) {
  const sockets = new Set<Socket>();

  const unsubscribeAccounts = accounts?.subscribe((snapshot) => {
    const payload = JSON.stringify({ type: 'accounts', accounts: snapshot } satisfies ServerMessage);
    for (const socket of sockets) socket.send(payload);
  });

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
          await dispatchUserCommand(engine, message.command, message.id, classify);
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
      if (accounts) send(socket, { type: 'accounts', accounts: accounts.snapshot() });
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
      unsubscribeAccounts?.();
    },
  };
}
