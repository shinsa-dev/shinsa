import type { TimingSpan, UserCommand } from '@shinsa/core';
import { CommandRefused } from '@/lib/connection/engine-socket/schema.ts';
import { connection, hasEngineCommand, sendCommand } from '@/lib/connection/socket.ts';
import { subscribeDesktopAway } from '@/lib/desktop.ts';

interface AwayRelayPorts {
  canSend: () => boolean;
  send: (command: UserCommand) => Promise<unknown>;
}

function isNotConnected(error: unknown) {
  return error instanceof CommandRefused && error.code === 'not_connected';
}

export function createAwayRelay(ports: AwayRelayPorts) {
  const pending: TimingSpan[] = [];
  const flush = () => {
    if (pending.length === 0 || !ports.canSend()) return;
    for (const span of pending.splice(0)) {
      void ports.send({ type: 'away.record', ...span }).then(undefined, (error: unknown) => {
        if (isNotConnected(error)) pending.push(span);
      });
    }
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
