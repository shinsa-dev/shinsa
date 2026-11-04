import type { TimingSpan, UserCommand } from '@shinsa/core';
import { Effect } from 'effect';
import { CommandRefused } from '@/lib/connection/engine-socket/schema.ts';
import { connection, hasEngineCommand, sendCommand } from '@/lib/connection/socket.ts';
import { subscribeDesktopAway } from '@/lib/desktop.ts';
import { forkApp } from '@/lib/runtime/app.ts';

interface AwayRelayPorts {
  canSend: () => boolean;
  send: (command: UserCommand) => Promise<unknown>;
}

function isNotConnected(error: unknown) {
  return error instanceof CommandRefused && error.code === 'not_connected';
}

export function createAwayRelay(ports: AwayRelayPorts) {
  const pending: TimingSpan[] = [];
  const sendSpan = (span: TimingSpan) =>
    Effect.tryPromise({
      try: () => ports.send({ type: 'away.record', ...span }),
      catch: isNotConnected,
    }).pipe(Effect.catch((notConnected) => Effect.sync(() => notConnected && pending.push(span))));
  const flush = () => {
    if (pending.length === 0 || !ports.canSend()) return;
    forkApp(Effect.forEach(pending.splice(0), sendSpan, { concurrency: 'unbounded', discard: true }));
  };
  const record = (span: TimingSpan) => {
    pending.push(span);
    flush();
  };
  return { record, flush, pending: () => pending.length };
}

export function relayDesktopAway() {
  const relay = createAwayRelay({ canSend: () => hasEngineCommand('away.record'), send: sendCommand });
  const stopAway = subscribeDesktopAway(relay.record);
  const stopConnection = connection.subscribe(relay.flush);
  return () => {
    stopAway();
    stopConnection();
  };
}
