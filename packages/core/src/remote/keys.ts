import { Effect } from 'effect';
import { parseJsonRecord } from '../domain/records.ts';
import { type Bytes, hasBytes, parseBase64Url, serializeBase64Url, serializeHex } from './bytes.ts';

export const REMOTE_KEY_ALGORITHM = { name: 'ECDH', namedCurve: 'P-256' } as const;

export const SIGNING_KEY_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;

const RAW_PUBLIC_KEY_BYTES = 65;

const FINGERPRINT_BYTES = 10;

function importKeyOrNull(importKey: () => Promise<CryptoKey>) {
  return Effect.tryPromise(importKey).pipe(Effect.orElseSucceed(() => null));
}

export const serializePublicKey = Effect.fn('serializePublicKey')(function* (key: CryptoKey) {
  return serializeBase64Url(new Uint8Array(yield* Effect.promise(() => crypto.subtle.exportKey('raw', key))));
});

export const parsePublicKey = Effect.fn('parsePublicKey')(function* (text: string) {
  const raw = parseBase64Url(text);
  if (!raw || raw.length !== RAW_PUBLIC_KEY_BYTES) return null;
  return yield* importKeyOrNull(() => crypto.subtle.importKey('raw', raw, REMOTE_KEY_ALGORITHM, true, []));
});

export const serializePrivateKey = Effect.fn('serializePrivateKey')(function* (key: CryptoKey) {
  return JSON.stringify(yield* Effect.promise(() => crypto.subtle.exportKey('jwk', key)));
});

export const parsePrivateKey = Effect.fn('parsePrivateKey')(function* (text: string) {
  const jwk = parseJsonRecord(text);
  if (!jwk) return null;
  return yield* importKeyOrNull(() =>
    crypto.subtle.importKey('jwk', jwk, REMOTE_KEY_ALGORITHM, false, ['deriveBits'])
  );
});

export function isSigningPublicKey(text: string) {
  return hasBytes(text, RAW_PUBLIC_KEY_BYTES);
}

export const parseSigningPublicKey = Effect.fn('parseSigningPublicKey')(function* (text: string) {
  const raw = isSigningPublicKey(text) ? parseBase64Url(text) : null;
  if (!raw) return null;
  return yield* importKeyOrNull(() =>
    crypto.subtle.importKey('raw', raw, SIGNING_KEY_ALGORITHM, true, ['verify'])
  );
});

export const parseSigningPrivateKey = Effect.fn('parseSigningPrivateKey')(function* (text: string) {
  const jwk = parseJsonRecord(text);
  if (!jwk) return null;
  return yield* importKeyOrNull(() =>
    crypto.subtle.importKey('jwk', jwk, SIGNING_KEY_ALGORITHM, false, ['sign'])
  );
});

export const resolveKeyFingerprint = Effect.fn('resolveKeyFingerprint')(function* (publicKey: string) {
  const raw = parseBase64Url(publicKey) ?? new Uint8Array();
  const digest = new Uint8Array(yield* Effect.promise(() => crypto.subtle.digest('SHA-256', raw))) as Bytes;
  const hex = serializeHex(digest.slice(0, FINGERPRINT_BYTES));
  return hex.match(/.{4}/g)?.join(' ') ?? hex;
});
