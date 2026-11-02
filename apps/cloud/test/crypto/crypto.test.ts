import { describe, expect, test } from 'bun:test';
import { Effect, Exit, Option, Redacted } from 'effect';
import { CloudCrypto } from '../../src/crypto/service.ts';
import { runTest } from '../layers.ts';

const SLACK_TIMESTAMP = '1800000000';

describe('random tokens, ids and codes', () => {
  test('a token is base64url of the bytes asked for, and two are never the same', async () => {
    const [first, second, short] = await runTest(
      CloudCrypto.use((crypto) =>
        Effect.all([crypto.createToken(), crypto.createToken(), crypto.createToken(24)])
      )
    );
    expect(Redacted.value(first)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Redacted.value(short)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(Redacted.value(first)).not.toBe(Redacted.value(second));
    expect(String(first)).not.toContain(Redacted.value(first));
  });

  test('claim codes leave out the letters people confuse, ids are lower case', async () => {
    const [claim, instance, team] = await runTest(
      CloudCrypto.use((crypto) =>
        Effect.all([crypto.createClaimCode, crypto.createInstanceId, crypto.createTeamId])
      )
    );
    expect(claim).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(instance).toMatch(/^[a-z0-9]{12}$/);
    expect(team).toMatch(/^[a-z0-9]{12}$/);
  });
});

describe('hashes', () => {
  test('a token hash is the SHA-256 of the token in hex', async () => {
    const hash = await runTest(CloudCrypto.use((crypto) => crypto.hashToken(Redacted.make('abc'))));
    expect(String(hash)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('a code challenge is PKCE S256 of the verifier', async () => {
    const challenge = await runTest(
      CloudCrypto.use((crypto) =>
        crypto.createCodeChallenge(Redacted.make('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      )
    );
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('sealed bot tokens', () => {
  test('a sealed token opens to the same token, and sealing twice never gives the same text', async () => {
    const [first, second, opened] = await runTest(
      CloudCrypto.use((crypto) =>
        Effect.gen(function* () {
          const token = Redacted.make('xoxb-bot-token');
          const readFirst = yield* crypto.sealToken(token);
          const readSecond = yield* crypto.sealToken(token);
          return [readFirst, readSecond, Redacted.value(yield* crypto.openToken(readFirst))] as const;
        })
      )
    );
    expect(first).not.toContain('xoxb');
    expect(first).not.toBe(second);
    expect(opened).toBe('xoxb-bot-token');
  });

  test.each([
    ['text that is not sealed', 'not sealed!'],
    ['a sealed text too short to hold its IV', 'AAAA'],
    ['a sealed text changed on the way', 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'],
  ])('%s is a defect, never a token', async (_, sealed) => {
    const exit = await runTest(Effect.exit(CloudCrypto.use((crypto) => crypto.openToken(sealed))));
    expect(Exit.isFailure(exit) && Exit.hasDies(exit)).toBe(true);
  });

  test('a key that is not 32 bytes is a defect the first time a token is sealed', async () => {
    const exit = await runTest(
      Effect.exit(CloudCrypto.use((crypto) => crypto.sealToken(Redacted.make('xoxb')))),
      { env: { SLACK_TOKEN_KEY: 'c2hvcnQ' } }
    );
    expect(Exit.isFailure(exit) && Exit.hasDies(exit)).toBe(true);
  });
});

describe('Slack signatures', () => {
  test('a body signed with the signing secret checks, and any change to it does not', async () => {
    const results = await runTest(
      CloudCrypto.use((crypto) =>
        Effect.gen(function* () {
          const signature = Option.getOrThrow(yield* crypto.signSlack(SLACK_TIMESTAMP, '{"a":1}'));
          return [
            signature,
            yield* crypto.isSlackSignature(SLACK_TIMESTAMP, '{"a":1}', signature),
            yield* crypto.isSlackSignature(SLACK_TIMESTAMP, '{"a":2}', signature),
            yield* crypto.isSlackSignature('1800000001', '{"a":1}', signature),
            yield* crypto.isSlackSignature(SLACK_TIMESTAMP, '{"a":1}', 'v0=short'),
          ] as const;
        })
      )
    );
    expect(results[0]).toMatch(/^v0=[0-9a-f]{64}$/);
    expect(results.slice(1)).toEqual([true, false, false, false]);
  });

  test('with no signing secret nothing is signed and nothing checks, so an empty key cannot be forged', async () => {
    const [signed, checked] = await runTest(
      CloudCrypto.use((crypto) =>
        Effect.all([
          crypto.signSlack(SLACK_TIMESTAMP, 'body'),
          crypto.isSlackSignature(SLACK_TIMESTAMP, 'body', 'v0=anything'),
        ])
      ),
      { env: { SLACK_SIGNING_SECRET: '' } }
    );
    expect(Option.isNone(signed)).toBe(true);
    expect(checked).toBe(false);
  });
});
