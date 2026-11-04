import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { serializeBase64Url } from '../../src/remote/bytes.ts';
import {
  isSigningPublicKey,
  parsePrivateKey,
  parsePublicKey,
  parseSigningPrivateKey,
  parseSigningPublicKey,
  resolveKeyFingerprint,
  SIGNING_KEY_ALGORITHM,
  serializePrivateKey,
  serializePublicKey,
} from '../../src/remote/keys.ts';
import { createKeyPair } from './helpers.ts';

describe('remote keys', () => {
  test('round-trips a public key as raw base64url', async () => {
    const pair = await createKeyPair();
    const text = await Effect.runPromise(serializePublicKey(pair.publicKey));
    const parsed = await Effect.runPromise(parsePublicKey(text));
    expect(parsed).not.toBeNull();
    expect(await Effect.runPromise(serializePublicKey(parsed as CryptoKey))).toBe(text);
  });

  test('refuses a public key of the wrong length, encoding or curve point', async () => {
    expect(await Effect.runPromise(parsePublicKey('not base64!'))).toBeNull();
    expect(await Effect.runPromise(parsePublicKey(serializeBase64Url(new Uint8Array(10))))).toBeNull();
    const offCurve = new Uint8Array(65);
    offCurve[0] = 4;
    expect(await Effect.runPromise(parsePublicKey(serializeBase64Url(offCurve)))).toBeNull();
  });

  test('round-trips a private key, and refuses one that is not a P-256 JWK', async () => {
    const pair = await createKeyPair();
    expect(
      await Effect.runPromise(parsePrivateKey(await Effect.runPromise(serializePrivateKey(pair.privateKey))))
    ).not.toBeNull();
    expect(await Effect.runPromise(parsePrivateKey('{'))).toBeNull();
    expect(await Effect.runPromise(parsePrivateKey('{"kty":"oct"}'))).toBeNull();
  });

  test('gives a short fingerprint in groups of four, the same for the same key', async () => {
    const pair = await createKeyPair();
    const text = await Effect.runPromise(serializePublicKey(pair.publicKey));
    const fingerprint = await Effect.runPromise(resolveKeyFingerprint(text));
    expect(fingerprint).toMatch(/^([0-9a-f]{4} ){4}[0-9a-f]{4}$/);
    expect(await Effect.runPromise(resolveKeyFingerprint(text))).toBe(fingerprint);
    expect(await Effect.runPromise(resolveKeyFingerprint('!'))).toMatch(/^([0-9a-f]{4} ){4}[0-9a-f]{4}$/);
  });

  test('round-trips a signing key pair, and refuses a public key of the wrong shape or a bad private key', async () => {
    const pair = (await crypto.subtle.generateKey(SIGNING_KEY_ALGORITHM, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const text = await Effect.runPromise(serializePublicKey(pair.publicKey));
    expect(isSigningPublicKey(text)).toBe(true);
    expect(await Effect.runPromise(parseSigningPublicKey(text))).not.toBeNull();
    expect(
      await Effect.runPromise(
        parseSigningPrivateKey(await Effect.runPromise(serializePrivateKey(pair.privateKey)))
      )
    ).not.toBeNull();
    expect(isSigningPublicKey('not base64!')).toBe(false);
    expect(isSigningPublicKey(serializeBase64Url(new Uint8Array(10)))).toBe(false);
    expect(await Effect.runPromise(parseSigningPublicKey(serializeBase64Url(new Uint8Array(10))))).toBeNull();
    const offCurve = new Uint8Array(65);
    offCurve[0] = 4;
    expect(await Effect.runPromise(parseSigningPublicKey(serializeBase64Url(offCurve)))).toBeNull();
    expect(await Effect.runPromise(parseSigningPrivateKey('{'))).toBeNull();
  });
});
