import { concatBytes, decodeText, encodeText, parseBase64Url, serializeBase64Url } from '@shinsa/core';

const CONFUSABLE = new Set(['I', 'O', '0', '1']);

const CLAIM_ALPHABET = [
  ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)),
  ...'23456789',
]
  .filter((character) => !CONFUSABLE.has(character))
  .join('');

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function createRandomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function createToken(bytes = 32) {
  return serializeBase64Url(createRandomBytes(bytes));
}

function createFromAlphabet(alphabet: string, length: number) {
  const limit = 256 - (256 % alphabet.length);
  let text = '';
  while (text.length < length) {
    for (const byte of createRandomBytes(length * 2)) {
      if (byte >= limit || text.length === length) continue;
      text += alphabet[byte % alphabet.length];
    }
  }
  return text;
}

export function createClaimCode() {
  return createFromAlphabet(CLAIM_ALPHABET, 8);
}

export function createInstanceId() {
  return createFromAlphabet(ID_ALPHABET, 12);
}

export async function resolveTokenHash(token: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encodeText(token)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createCodeChallenge(verifier: string) {
  return serializeBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encodeText(verifier))));
}

export function isSameSecret(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

const SEALED_IV_BYTES = 12;

function importTokenKey(secret: string) {
  const raw = parseBase64Url(secret);
  if (raw?.length !== 32) throw new Error('SLACK_TOKEN_KEY must be 32 bytes in base64url.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptToken(secret: string, token: string) {
  const iv = createRandomBytes(SEALED_IV_BYTES);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importTokenKey(secret), encodeText(token))
  );
  return serializeBase64Url(concatBytes(iv, sealed));
}

export async function decryptToken(secret: string, sealed: string) {
  const bytes = parseBase64Url(sealed);
  if (!bytes || bytes.length <= SEALED_IV_BYTES) throw new Error('The stored token is not sealed.');
  const opened = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, SEALED_IV_BYTES) },
    await importTokenKey(secret),
    bytes.slice(SEALED_IV_BYTES)
  );
  return decodeText(new Uint8Array(opened));
}

export async function createSlackSignature(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encodeText(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encodeText(`v0:${timestamp}:${body}`)));
  return `v0=${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
