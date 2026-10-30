import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { REMOTE_PATHS } from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import { ControlClient } from '../../src/remote/control.ts';
import { Pairing } from '../../src/remote/pairing.ts';
import { type FakeControlPlane, startFakeControlPlane } from './control-plane.ts';

const START = {
  claimCode: 'K7PQ',
  pollSecret: 'poll',
  url: 'https://shinsa.dev/app/pair',
  expiresAt: 10_000,
};

const CREDENTIALS = {
  instanceId: 'k3x9',
  machineToken: 'm',
  tunnelToken: 't',
  tunnelHost: 't-k3x9.shinsa.dev',
  connectKey: 'c',
};

const planes: FakeControlPlane[] = [];

afterEach(async () => {
  for (const plane of planes.splice(0)) await plane.stop();
});

function startPairing(now = () => 0) {
  const plane = startFakeControlPlane();
  planes.push(plane);
  const control = new ControlClient({ origin: plane.origin });
  return { plane, pairing: new Pairing({ control, start: START, pollMs: 1, now }) };
}

function answerPolls(fake: FakeControlPlane, ...bodies: unknown[]) {
  let index = 0;
  fake.answers.set(REMOTE_PATHS.pairPoll, () => {
    const body = bodies[Math.min(index, bodies.length - 1)];
    index += 1;
    return body === 500 ? new Response('', { status: 500 }) : Response.json(body);
  });
}

describe('pairing', () => {
  test('polls with the secret until the instance is claimed, through failed polls', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const { plane: fake, pairing } = startPairing();
    answerPolls(fake, { status: 'pending' }, 500, {
      status: 'claimed',
      credentials: CREDENTIALS,
      owner: 'mona',
    });
    expect(pairing.view).toEqual({ claimCode: 'K7PQ', url: START.url, expiresAt: START.expiresAt });
    expect(await pairing.done).toEqual({
      status: 'claimed',
      machine: { credentials: CREDENTIALS, owner: 'mona' },
    });
    expect(fake.calls.map((call) => call.body)).toEqual([
      { claimCode: 'K7PQ', pollSecret: 'poll' },
      { claimCode: 'K7PQ', pollSecret: 'poll' },
      { claimCode: 'K7PQ', pollSecret: 'poll' },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('ends when shinsa.dev/app says the code expired, or once its time is up', async () => {
    const answered = startPairing();
    answerPolls(answered.plane, { status: 'expired' });
    expect(await answered.pairing.done).toEqual({ status: 'expired' });
    const timed = startPairing(() => START.expiresAt);
    expect(await timed.pairing.done).toEqual({ status: 'expired' });
    expect(timed.plane.calls).toHaveLength(0);
  });

  test('stops when cancelled, even with a poll on its way', async () => {
    const { plane: fake, pairing } = startPairing();
    fake.answers.set(REMOTE_PATHS.pairPoll, () => {
      pairing.cancel();
      return Response.json({ status: 'claimed', credentials: CREDENTIALS, owner: 'mona' });
    });
    expect(await pairing.done).toEqual({ status: 'cancelled' });
    pairing.cancel();
    const idle = startPairing();
    idle.pairing.cancel();
    expect(await idle.pairing.done).toEqual({ status: 'cancelled' });
  });
});
