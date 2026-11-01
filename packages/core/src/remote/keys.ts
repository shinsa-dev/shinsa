import { type Bytes, parseBase64Url, serializeBase64Url, serializeHex } from './bytes.ts';

export const REMOTE_KEY_ALGORITHM = { name: 'ECDH', namedCurve: 'P-256' } as const;

export const SIGNING_KEY_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;

const RAW_PUBLIC_KEY_BYTES = 65;

const FINGERPRINT_BYTES = 10;

type WebKey = Exclude<Awaited<ReturnType<typeof crypto.subtle.exportKey>>, ArrayBuffer>;

export async function serializePublicKey(key: CryptoKey) {
  return serializeBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

export async function parsePublicKey(text: string) {
  const raw = parseBase64Url(text);
  if (!raw || raw.length !== RAW_PUBLIC_KEY_BYTES) return null;
  try {
    return await crypto.subtle.importKey('raw', raw, REMOTE_KEY_ALGORITHM, true, []);
  } catch {
    return null;
  }
}

export async function serializePrivateKey(key: CryptoKey) {
  return JSON.stringify(await crypto.subtle.exportKey('jwk', key));
}

export async function parsePrivateKey(text: string) {
  try {
    return await crypto.subtle.importKey('jwk', JSON.parse(text) as WebKey, REMOTE_KEY_ALGORITHM, false, [
      'deriveBits',
    ]);
  } catch {
    return null;
  }
}

export function isSigningPublicKey(text: string) {
  return /^[A-Za-z0-9_-]+$/.test(text) && parseBase64Url(text)?.length === RAW_PUBLIC_KEY_BYTES;
}

export async function parseSigningPublicKey(text: string) {
  const raw = isSigningPublicKey(text) ? parseBase64Url(text) : null;
  if (!raw) return null;
  try {
    return await crypto.subtle.importKey('raw', raw, SIGNING_KEY_ALGORITHM, true, ['verify']);
  } catch {
    return null;
  }
}

export async function parseSigningPrivateKey(text: string) {
  try {
    return await crypto.subtle.importKey('jwk', JSON.parse(text) as WebKey, SIGNING_KEY_ALGORITHM, false, [
      'sign',
    ]);
  } catch {
    return null;
  }
}

export async function resolveKeyFingerprint(publicKey: string) {
  const raw = parseBase64Url(publicKey) ?? new Uint8Array();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw)) as Bytes;
  const hex = serializeHex(digest.slice(0, FINGERPRINT_BYTES));
  return hex.match(/.{4}/g)?.join(' ') ?? hex;
}
