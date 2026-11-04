import { Effect } from 'effect';
import { type Bytes, concatBytes, parseBase64Url, serializeBase64Url } from './bytes.ts';
import { RemoteKeyInvalid } from './schema.ts';

export const importHmacKey = Effect.fn('importHmacKey')(function* (secret: string) {
  const raw = parseBase64Url(secret);
  if (!raw || raw.length === 0) return null;
  return yield* Effect.promise(() =>
    crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  );
});

export const findHmacKey = Effect.fn('findHmacKey')(function* (secret: string, message: string) {
  const key = yield* importHmacKey(secret);
  if (!key) return yield* new RemoteKeyInvalid({ message });
  return key;
});

export const signHmac = Effect.fn('signHmac')(function* (key: CryptoKey, message: Bytes) {
  return new Uint8Array(yield* Effect.promise(() => crypto.subtle.sign('HMAC', key, message)));
});

export const verifyHmac = Effect.fn('verifyHmac')(function* (
  key: CryptoKey,
  signature: Bytes,
  message: Bytes
) {
  return yield* Effect.promise(() => crypto.subtle.verify('HMAC', key, signature, message));
});

export const createSignedToken = Effect.fn('createSignedToken')(function* (
  key: CryptoKey,
  label: Bytes,
  payload: Bytes
) {
  const signature = yield* signHmac(key, concatBytes(label, payload));
  return `${serializeBase64Url(payload)}.${serializeBase64Url(signature)}`;
});

export const verifySignedToken = Effect.fn('verifySignedToken')(function* (
  secret: string,
  label: Bytes,
  token: string
) {
  const [encoded, encodedSignature, extra] = token.split('.');
  if (encoded === undefined || encodedSignature === undefined || extra !== undefined) return null;
  const payload = parseBase64Url(encoded);
  const signature = parseBase64Url(encodedSignature);
  const key = yield* importHmacKey(secret);
  if (!payload || !signature || !key) return null;
  if (!(yield* verifyHmac(key, signature, concatBytes(label, payload)))) return null;
  return payload;
});
