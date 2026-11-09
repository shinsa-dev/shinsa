import { Effect, Option, Schema } from 'effect';
import {
  CDP_CLOSED_MESSAGE,
  CDP_TIMEOUT,
  CDP_TIMEOUT_MESSAGE,
  CDP_UNREACHABLE_MESSAGE,
  CdpFailed,
  type CdpFailureReason,
  CdpReply,
} from './schema.ts';

const decodeReply = Schema.decodeUnknownOption(CdpReply);

export function sendCdpCommand(webSocketUrl: string, method: string, params: object = {}) {
  return Effect.callback<unknown, CdpFailed>((resume) => {
    const socket = new WebSocket(webSocketUrl);
    let opened = false;
    const fail = (reason: CdpFailureReason, message: string) =>
      resume(Effect.fail(new CdpFailed({ method, reason, message })));
    const drop = () =>
      opened ? fail('closed', CDP_CLOSED_MESSAGE) : fail('unreachable', CDP_UNREACHABLE_MESSAGE);
    socket.onopen = () => {
      opened = true;
      socket.send(JSON.stringify({ id: 1, method, params }));
    };
    socket.onmessage = (event) => {
      const reply = Option.getOrNull(decodeReply(String(event.data)));
      if (reply?.id !== 1) return;
      socket.onclose = null;
      socket.close();
      if (reply.error) fail('refused', reply.error.message);
      else resume(Effect.succeed(reply.result));
    };
    socket.onerror = drop;
    socket.onclose = drop;
    return Effect.sync(() => {
      socket.onclose = null;
      socket.close();
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: CDP_TIMEOUT,
      orElse: () => Effect.fail(new CdpFailed({ method, reason: 'timeout', message: CDP_TIMEOUT_MESSAGE })),
    }),
    Effect.withSpan('Cdp.send', { attributes: { method } })
  );
}
