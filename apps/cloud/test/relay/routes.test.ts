import { describe, expect, test } from 'bun:test';
import { resolveRelayPath } from '@shinsa/core';
import { RELAY_ADDRESS_HEADER, RELAY_ROLE_HEADER } from '../../src/relay/schema.ts';
import { createHarness, type Harness, pairMachine } from '../harness.ts';

const RELAYED = 'x-relayed';

async function setUp() {
  const harness = createHarness();
  const session = await harness.signIn('mona', 1);
  const studio = await pairMachine(harness, session, 'Studio');
  const laptop = await pairMachine(harness, session, 'Laptop');
  harness.handlers.push((call) =>
    new URL(call.url).hostname.endsWith('.relay.test')
      ? new Response(null, { status: 200, headers: { [RELAYED]: 'yes' } })
      : new Response('', { status: 599 })
  );
  return { harness, studio, laptop };
}

function upgrade(harness: Harness, path: string, headers: Record<string, string> = {}) {
  return harness.call(path, { headers: { upgrade: 'websocket', ...headers } });
}

function listRelayCalls(harness: Harness) {
  return harness.calls.filter((call) => new URL(call.url).hostname.endsWith('.relay.test'));
}

describe('the relay routes', () => {
  test('connect a machine signed in with its own token, passing the room’s answer through untouched', async () => {
    const { harness, studio } = await setUp();
    const answer = await upgrade(harness, `${resolveRelayPath(studio.instanceId)}/machine`, {
      authorization: `Bearer ${studio.machineToken}`,
    });
    expect(answer.headers.get(RELAYED)).toBe('yes');
    expect(answer.headers.has('content-security-policy')).toBe(false);
    const [call] = listRelayCalls(harness);
    expect(call?.url).toBe(`https://${studio.instanceId}.relay.test/`);
    expect(call?.headers.get(RELAY_ROLE_HEADER)).toBe('machine');
    expect(call?.headers.has('authorization')).toBe(false);
  });

  test('refuse a machine socket without a token, with a wrong one, or with another machine’s', async () => {
    const { harness, studio, laptop } = await setUp();
    const path = `${resolveRelayPath(studio.instanceId)}/machine`;
    for (const authorization of [
      undefined,
      'Bearer ',
      'Bearer not-a-token',
      `Bearer ${laptop.machineToken}`,
    ]) {
      const answer = await upgrade(harness, path, authorization ? { authorization } : {});
      expect(answer.status).toBe(401);
    }
    expect(listRelayCalls(harness)).toEqual([]);
  });

  test('open a browser socket on the machine without its cookies or credentials, from its address', async () => {
    const { harness, studio } = await setUp();
    const answer = await upgrade(harness, `${resolveRelayPath(studio.instanceId)}/remote?token=abc`, {
      cookie: '__Host-shinsa_session=secret',
      authorization: 'Bearer secret',
      'cf-connecting-ip': '203.0.113.9',
      'sec-websocket-protocol': 'shinsa',
      origin: 'https://app.shinsa.dev',
    });
    expect(answer.headers.get(RELAYED)).toBe('yes');
    const [call] = listRelayCalls(harness);
    expect(call?.url).toBe(`https://${studio.instanceId}.relay.test/remote?token=abc`);
    expect(call?.headers.get(RELAY_ROLE_HEADER)).toBe('socket');
    expect(call?.headers.get(RELAY_ADDRESS_HEADER)).toBe('203.0.113.9');
    expect(call?.headers.get('sec-websocket-protocol')).toBe('shinsa');
    expect(call?.headers.has('cookie')).toBe(false);
    expect(call?.headers.has('authorization')).toBe(false);
    expect(call?.headers.has('cf-connecting-ip')).toBe(false);
  });

  test('take only socket upgrades, and only for a machine that exists', async () => {
    const { harness, studio } = await setUp();
    const plain = await harness.call(`${resolveRelayPath(studio.instanceId)}/remote`);
    expect(plain.status).toBe(404);
    expect((await upgrade(harness, `${resolveRelayPath('nosuchmachine')}/remote`)).status).toBe(404);
    expect((await upgrade(harness, '/__relay/bad%20id/remote')).status).toBe(404);
    expect(listRelayCalls(harness)).toEqual([]);
  });

  test('say the machine is offline when its room cannot be reached', async () => {
    const { harness, studio } = await setUp();
    harness.handlers.unshift((call) => {
      if (new URL(call.url).hostname.endsWith('.relay.test')) throw new Error('The room is gone.');
      return new Response('', { status: 599 });
    });
    const socket = await upgrade(harness, `${resolveRelayPath(studio.instanceId)}/remote`);
    expect(socket.status).toBe(503);
    expect(socket.headers.get('retry-after')).toBe('30');
    const machine = await upgrade(harness, `${resolveRelayPath(studio.instanceId)}/machine`, {
      authorization: `Bearer ${studio.machineToken}`,
    });
    expect(machine.status).toBe(503);
  });
});
