import { encodeText, serializeBase64Url } from '@shinsa/core';

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

export function isSameSecret(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
