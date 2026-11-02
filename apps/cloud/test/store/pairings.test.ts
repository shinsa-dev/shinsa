import { describe, expect, test } from 'bun:test';
import { ClaimCode, type MachineCredentials } from '@shinsa/core';
import { Effect, Option } from 'effect';
import { TestClock } from 'effect/testing';
import { Pairings } from '../../src/store/pairings/service.ts';
import { runTest, TEST_NOW } from '../layers.ts';
import { hashOf, KAI, MONA, seedUsers } from './fixtures.ts';

const CODE = ClaimCode.make('ABCD2345');

const PAIRING = {
  claimCode: CODE,
  pollSecretHash: hashOf('f'),
  name: 'Studio',
  publicKey: 'public-key',
  version: '1',
  expiresAt: TEST_NOW + 600_000,
};

const CREDENTIALS: MachineCredentials = {
  instanceId: 'studio000001',
  machineToken: 'machine-token',
  connectKey: 'connect-key',
  tunnelToken: 'tunnel-token',
  tunnelHost: 'studio000001.shinsa.dev',
};

describe('pairings', () => {
  test('a pairing waits with no owner and no credentials, and counts against its address', async () => {
    const [pairing, fromHere, fromElsewhere] = await runTest(
      Effect.gen(function* () {
        const pairings = yield* Pairings;
        yield* pairings.create(PAIRING, '203.0.113.1');
        return [
          yield* pairings.select(CODE),
          yield* pairings.countFrom('203.0.113.1'),
          yield* pairings.countFrom('203.0.113.2'),
        ] as const;
      })
    );
    expect(pairing).toEqual(Option.some({ ...PAIRING, credentials: null, owner: null }));
    expect([fromHere, fromElsewhere]).toEqual([1, 0]);
  });

  test('only one approval reserves a code; releasing it before the claim lets another try', async () => {
    const steps = await runTest(
      Effect.gen(function* () {
        const pairings = yield* Pairings;
        yield* seedUsers(MONA, KAI);
        yield* pairings.create(PAIRING, '203.0.113.1');
        const first = yield* pairings.reserve(CODE, MONA.login);
        const second = yield* pairings.reserve(CODE, KAI.login);
        yield* pairings.release(CODE);
        const afterRelease = yield* pairings.reserve(CODE, KAI.login);
        return [first, second, afterRelease] as const;
      })
    );
    expect(steps).toEqual([true, false, true]);
  });

  test('a claimed pairing keeps its credentials and owner, and release no longer frees it', async () => {
    const pairing = await runTest(
      Effect.gen(function* () {
        const pairings = yield* Pairings;
        yield* seedUsers(MONA);
        yield* pairings.create(PAIRING, '203.0.113.1');
        yield* pairings.reserve(CODE, MONA.login);
        yield* pairings.recordClaim(CODE, CREDENTIALS);
        yield* pairings.release(CODE);
        return yield* pairings.select(CODE);
      })
    );
    expect(pairing).toEqual(Option.some({ ...PAIRING, credentials: CREDENTIALS, owner: MONA.login }));
  });

  test('expired and removed pairings are gone', async () => {
    const [expired, removed] = await runTest(
      Effect.gen(function* () {
        const pairings = yield* Pairings;
        yield* pairings.create({ ...PAIRING, expiresAt: TEST_NOW + 10 }, '203.0.113.1');
        yield* pairings.create({ ...PAIRING, claimCode: ClaimCode.make('WXYZ6789') }, '203.0.113.1');
        yield* TestClock.adjust('1 second');
        yield* pairings.removeExpired;
        const readExpired = yield* pairings.select(CODE);
        yield* pairings.remove(ClaimCode.make('WXYZ6789'));
        return [readExpired, yield* pairings.select(ClaimCode.make('WXYZ6789'))] as const;
      })
    );
    expect(Option.isNone(expired)).toBe(true);
    expect(Option.isNone(removed)).toBe(true);
  });
});
