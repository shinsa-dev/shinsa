import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import {
  AuthStatusAnswer,
  RegistryFields,
  SpentMarksFields,
  StoredAccountFields,
  StoredLoginAnswer,
  UsageCacheFields,
} from '../../src/accounts/schema.ts';

describe('what the accounts read from outside', () => {
  test('a field of the wrong kind is left out and the rest is kept', () => {
    const decode = Schema.decodeUnknownSync;
    expect(decode(RegistryFields)({ defaultAccountId: ' ', accounts: 'none' })).toEqual({});
    expect(decode(UsageCacheFields)({ accounts: [1] })).toEqual({});
    expect(decode(SpentMarksFields)({ marks: 'none' })).toEqual({});
    expect(
      decode(StoredAccountFields)({
        id: ' a1 ',
        origin: 'login',
        email: 4,
        addedAt: 'x',
        paused: 'y',
        switchAt: 400,
      })
    ).toEqual({ id: 'a1', origin: 'login' });
    expect(decode(AuthStatusAnswer)(JSON.stringify({ loggedIn: true, oauthAccount: 'x' }))).toEqual({
      loggedIn: true,
    });
    expect(
      decode(StoredLoginAnswer)(
        JSON.stringify({ claudeAiOauth: { accessToken: 't', refreshToken: 5, expiresAt: 'x' } })
      )
    ).toEqual({ claudeAiOauth: { accessToken: 't' } });
  });
});
