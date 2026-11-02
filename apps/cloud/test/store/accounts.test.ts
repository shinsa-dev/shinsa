import { describe, expect, test } from 'bun:test';
import { RemoteUserId } from '@shinsa/core';
import { Effect, Option } from 'effect';
import { TestClock } from 'effect/testing';
import { Accounts } from '../../src/store/accounts/service.ts';
import { runTest, TEST_NOW } from '../layers.ts';
import { hashOf, KAI, MONA, seedUsers } from './fixtures.ts';

describe('accounts', () => {
  test('a user signing in again keeps one row with their new login, name and avatar', async () => {
    const user = await runTest(
      Effect.gen(function* () {
        const accounts = yield* Accounts;
        yield* seedUsers(MONA);
        yield* accounts.upsertUser({ ...MONA, login: 'mona-renamed', name: null, avatarUrl: null });
        return yield* accounts.selectUser(MONA.id);
      })
    );
    expect(user).toEqual(Option.some({ ...MONA, login: 'mona-renamed', name: null, avatarUrl: null }));
  });

  test('an unknown user is none', async () => {
    const user = await runTest(Accounts.use((accounts) => accounts.selectUser(RemoteUserId.make('nobody'))));
    expect(Option.isNone(user)).toBe(true);
  });

  test('a session finds its user until it expires, and not after it is removed', async () => {
    const [live, expired, removed] = await runTest(
      Effect.gen(function* () {
        const accounts = yield* Accounts;
        yield* seedUsers(MONA, KAI);
        yield* accounts.createSession(hashOf('a'), MONA.id, TEST_NOW + 1000);
        yield* accounts.createSession(hashOf('b'), KAI.id, TEST_NOW);
        const readLive = yield* accounts.selectSessionUser(hashOf('a'));
        const readExpired = yield* accounts.selectSessionUser(hashOf('b'));
        yield* accounts.removeSession(hashOf('a'));
        return [readLive, readExpired, yield* accounts.selectSessionUser(hashOf('a'))] as const;
      })
    );
    expect(live).toEqual(Option.some(MONA));
    expect(Option.isNone(expired)).toBe(true);
    expect(Option.isNone(removed)).toBe(true);
  });

  test('a sign-in code is taken once, and expired codes are cleared when a new one is made', async () => {
    const [first, again, stale] = await runTest(
      Effect.gen(function* () {
        const accounts = yield* Accounts;
        yield* seedUsers(MONA);
        const code = { userId: MONA.id, codeChallenge: 'challenge', expiresAt: TEST_NOW + 60_000 };
        yield* accounts.createSignInCode(hashOf('c'), { ...code, expiresAt: TEST_NOW + 10 });
        yield* accounts.createSignInCode(hashOf('d'), code);
        const readFirst = yield* accounts.takeSignInCode(hashOf('d'));
        const readAgain = yield* accounts.takeSignInCode(hashOf('d'));
        yield* TestClock.adjust('1 second');
        yield* accounts.createSignInCode(hashOf('e'), code);
        return [readFirst, readAgain, yield* accounts.takeSignInCode(hashOf('c'))] as const;
      })
    );
    expect(first).toEqual(
      Option.some({ userId: MONA.id, codeChallenge: 'challenge', expiresAt: TEST_NOW + 60_000 })
    );
    expect(Option.isNone(again)).toBe(true);
    expect(Option.isNone(stale)).toBe(true);
  });
});
