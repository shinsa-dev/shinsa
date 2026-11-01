import { describe, expect, test } from 'bun:test';
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
    const text = await serializePublicKey(pair.publicKey);
    const parsed = await parsePublicKey(text);
    expect(parsed).not.toBeNull();
    expect(await serializePublicKey(parsed as CryptoKey)).toBe(text);
  });

  test('refuses a public key of the wrong length, encoding or curve point', async () => {
    expect(await parsePublicKey('not base64!')).toBeNull();
    expect(await parsePublicKey(serializeBase64Url(new Uint8Array(10)))).toBeNull();
    const offCurve = new Uint8Array(65);
    offCurve[0] = 4;
    expect(await parsePublicKey(serializeBase64Url(offCurve))).toBeNull();
  });

  test('round-trips a private key, and refuses one that is not a P-256 JWK', async () => {
    const pair = await createKeyPair();
    expect(await parsePrivateKey(await serializePrivateKey(pair.privateKey))).not.toBeNull();
    expect(await parsePrivateKey('{')).toBeNull();
    expect(await parsePrivateKey('{"kty":"oct"}')).toBeNull();
  });

  test('gives a short fingerprint in groups of four, the same for the same key', async () => {
    const pair = await createKeyPair();
    const text = await serializePublicKey(pair.publicKey);
    const fingerprint = await resolveKeyFingerprint(text);
    expect(fingerprint).toMatch(/^([0-9a-f]{4} ){4}[0-9a-f]{4}$/);
    expect(await resolveKeyFingerprint(text)).toBe(fingerprint);
    expect(await resolveKeyFingerprint('!')).toMatch(/^([0-9a-f]{4} ){4}[0-9a-f]{4}$/);
  });

  test('round-trips a signing key pair, and refuses a public key of the wrong shape or a bad private key', async () => {
    const pair = (await crypto.subtle.generateKey(SIGNING_KEY_ALGORITHM, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const text = await serializePublicKey(pair.publicKey);
    expect(isSigningPublicKey(text)).toBe(true);
    expect(await parseSigningPublicKey(text)).not.toBeNull();
    expect(await parseSigningPrivateKey(await serializePrivateKey(pair.privateKey))).not.toBeNull();
    expect(isSigningPublicKey('not base64!')).toBe(false);
    expect(isSigningPublicKey(serializeBase64Url(new Uint8Array(10)))).toBe(false);
    expect(await parseSigningPublicKey(serializeBase64Url(new Uint8Array(10)))).toBeNull();
    const offCurve = new Uint8Array(65);
    offCurve[0] = 4;
    expect(await parseSigningPublicKey(serializeBase64Url(offCurve))).toBeNull();
    expect(await parseSigningPrivateKey('{')).toBeNull();
  });
});
