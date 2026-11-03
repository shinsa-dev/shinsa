import { afterEach, describe, expect, it } from 'bun:test';
import type { UserCommand } from '@shinsa/core';
import { createAwayRelay, relayDesktopAway } from '@/lib/away.ts';
import { CommandRefused } from '@/lib/connection/engine-socket/schema.ts';
import { installDesktop } from '../support/desktop.ts';

let fake: ReturnType<typeof installDesktop> | null = null;

afterEach(() => {
  fake?.restore();
  fake = null;
});

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('time away from the Mac app', () => {
  it('sends each span as soon as the engine takes it, and holds it while it cannot', async () => {
    const sent: UserCommand[] = [];
    let open = false;
    const relay = createAwayRelay({
      canSend: () => open,
      send: (command) => {
        sent.push(command);
        return Promise.resolve();
      },
    });
    relay.record({ from: 1, to: 2 });
    expect(sent).toEqual([]);
    expect(relay.pending()).toBe(1);
    open = true;
    relay.flush();
    relay.flush();
    await settle();
    expect(sent).toEqual([{ type: 'away.record', from: 1, to: 2 }]);
    expect(relay.pending()).toBe(0);
  });

  it('keeps a span the socket was not connected for, and drops one the engine refused', async () => {
    const answers = [
      new CommandRefused({ code: 'not_connected', message: 'Not connected' }),
      new CommandRefused({ code: 'away_refused', message: 'Too long' }),
    ];
    const relay = createAwayRelay({
      canSend: () => true,
      send: () => Promise.reject(answers.shift()),
    });
    relay.record({ from: 1, to: 2 });
    await settle();
    expect(relay.pending()).toBe(1);
    relay.flush();
    await settle();
    expect(relay.pending()).toBe(0);
  });

  it('listens to the Mac app only while relaying', () => {
    fake = installDesktop();
    const stop = relayDesktopAway();
    expect(fake.awayListeners()).toBe(1);
    fake.away({ from: 1, to: 2 });
    stop();
    expect(fake.awayListeners()).toBe(0);
  });
});
