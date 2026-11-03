import { type Bytes, concatBytes, parseBase64Url, serializeBase64Url } from './bytes.ts';

export function importHmacKey(secret: string) {
  const raw = parseBase64Url(secret);
  if (!raw || raw.length === 0) return null;
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signHmac(key: CryptoKey, message: Bytes) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
}

export async function createSignedToken(key: CryptoKey, label: Bytes, payload: Bytes) {
  const signature = await signHmac(key, concatBytes(label, payload));
  return `${serializeBase64Url(payload)}.${serializeBase64Url(signature)}`;
}

export async function verifySignedToken(secret: string, label: Bytes, token: string): Promise<Bytes | null> {
  const [encoded, encodedSignature, extra] = token.split('.');
  if (encoded === undefined || encodedSignature === undefined || extra !== undefined) return null;
  const payload = parseBase64Url(encoded);
  const signature = parseBase64Url(encodedSignature);
  const key = await importHmacKey(secret);
  if (!payload || !signature || !key) return null;
  if (!(await crypto.subtle.verify('HMAC', key, signature, concatBytes(label, payload)))) return null;
  return payload;
}
