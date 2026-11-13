import { afterEach, describe, expect, test } from 'bun:test';
import { REMOTE_KEY_ALGORITHM, REMOTE_PATHS, serializePublicKey } from '@shinsa/core';
import { Effect, Exit, Fiber, Layer, ManagedRuntime } from 'effect';
import { JsonLogger } from '../../src/log/service.ts';
import { RemoteOrigin } from '../../src/remote/client/schema.ts';
import { RemoteClientLayer } from '../../src/remote/layers.ts';
import { type PairingEnd, PairPollInterval } from '../../src/remote/pairing/schema.ts';
import { Pairings } from '../../src/remote/pairing/service.ts';
import { captureLogs } from '../helpers/logs.ts';
import { type FakeControlPlane, sealCredentials, startFakeControlPlane } from './control-plane.ts';

const START = {
  claimCode: 'K7PQ',
  pollSecret: 'poll',
  url: 'https://app.shinsa.dev/pair',
  expiresAt: Date.now() + 60_000,
};

const CREDENTIALS = {
  instanceId: 'k3x9',
  machineToken: 'm',
  connectKey: 'c',
};

const PAIR = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits'])) as CryptoKeyPair;

const MACHINE = {
  publicKey: await Effect.runPromise(serializePublicKey(PAIR.publicKey)),
  privateKey: PAIR.privateKey,
};

const SEALED = await sealCredentials(MACHINE.publicKey, CREDENTIALS);

const planes: FakeControlPlane[] = [];

afterEach(async () => {
  for (const plane of planes.splice(0)) await plane.stop();
});

function startPairing(start = START) {
  const plane = startFakeControlPlane();
  planes.push(plane);
  const runtime = ManagedRuntime.make(
    RemoteClientLayer.pipe(
      Layer.provide(
        Layer.merge(Layer.succeed(RemoteOrigin, plane.origin), Layer.succeed(PairPollInterval, 1))
      ),
      Layer.provideMerge(JsonLogger)
    )
  );
  const fiber = runtime.runFork(Pairings.use((pairings) => pairings.await(start, MACHINE)));
  const done = runtime.runPromise(
    Fiber.await(fiber).pipe(
      Effect.map((exit): PairingEnd => (Exit.isSuccess(exit) ? exit.value : { status: 'cancelled' }))
    )
  );
  return { plane, pairing: { done, cancel: () => runtime.runFork(Fiber.interrupt(fiber)) } };
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
    const logs = captureLogs();
    const { plane: fake, pairing } = startPairing();
    answerPolls(fake, { status: 'pending' }, 500, {
      status: 'claimed',
      sealedCredentials: SEALED,
      owner: 'mona',
    });
    expect(await pairing.done).toEqual({
      status: 'claimed',
      machine: { credentials: CREDENTIALS, owner: 'mona' },
    });
    logs.restore();
    expect(fake.calls.map((call) => call.body)).toEqual([
      { claimCode: 'K7PQ', pollSecret: 'poll' },
      { claimCode: 'K7PQ', pollSecret: 'poll' },
      { claimCode: 'K7PQ', pollSecret: 'poll' },
    ]);
    expect(logs.fieldsOf('[Remote] Could not check on pairing; trying again')).toHaveLength(1);
  });

  test('ends when app.shinsa.dev says the code expired, or once its time is up', async () => {
    const answered = startPairing();
    answerPolls(answered.plane, { status: 'expired' });
    expect(await answered.pairing.done).toEqual({ status: 'expired' });
    const timed = startPairing({ ...START, expiresAt: Date.now() - 1 });
    expect(await timed.pairing.done).toEqual({ status: 'expired' });
    expect(timed.plane.calls).toHaveLength(0);
  });

  test('ends without pairing when the credentials were not sealed to this machine’s key', async () => {
    const logs = captureLogs();
    const other = await sealCredentials(
      await Effect.runPromise(
        serializePublicKey(
          ((await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits'])) as CryptoKeyPair)
            .publicKey
        )
      ),
      CREDENTIALS
    );
    for (const sealedCredentials of [other, 'not-sealed']) {
      const { plane: fake, pairing } = startPairing();
      answerPolls(fake, { status: 'claimed', sealedCredentials, owner: 'mona' });
      expect(await pairing.done).toEqual({ status: 'expired' });
    }
    logs.restore();
    expect(logs.fieldsOf('[Remote] The pairing credentials did not open with this machine key')).toHaveLength(
      2
    );
  });

  test('refuses credentials sent in the clear, as app.shinsa.dev sends an older engine', async () => {
    const logs = captureLogs();
    const { plane: fake, pairing } = startPairing();
    answerPolls(fake, { status: 'claimed', credentials: CREDENTIALS, owner: 'mona' });
    expect(await pairing.done).toEqual({ status: 'expired' });
    logs.restore();
    expect(
      logs.fieldsOf('[Remote] The pairing credentials arrived unsealed, so this machine refused them')
    ).toHaveLength(1);
  });

  test('stops when cancelled, even with a poll on its way', async () => {
    const { plane: fake, pairing } = startPairing();
    fake.answers.set(REMOTE_PATHS.pairPoll, () => {
      pairing.cancel();
      return Response.json({ status: 'claimed', sealedCredentials: SEALED, owner: 'mona' });
    });
    expect(await pairing.done).toEqual({ status: 'cancelled' });
    pairing.cancel();
    const idle = startPairing();
    idle.pairing.cancel();
    expect(await idle.pairing.done).toEqual({ status: 'cancelled' });
  });
});
