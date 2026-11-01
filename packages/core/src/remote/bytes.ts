export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

const decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeText(text: string): Bytes {
  return encoder.encode(text) as Bytes;
}

export function decodeText(bytes: Bytes) {
  return decoder.decode(bytes);
}

export function concatBytes(...parts: Bytes[]): Bytes {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

export function serializeBase64Url(bytes: Bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function parseBase64Url(text: string): Bytes | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export function serializeBase32(bytes: Bytes) {
  let text = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      text += BASE32_ALPHABET[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) text += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return text;
}

export function parseBase32(text: string): Bytes | null {
  if (!/^[a-z2-7]*$/.test(text) || [1, 3, 6].includes(text.length % 8)) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of text) {
    buffer = ((buffer << 5) | BASE32_ALPHABET.indexOf(character)) & 0xfff;
    bits += 5;
    if (bits < 8) continue;
    bits -= 8;
    bytes.push((buffer >> bits) & 255);
  }
  if ((buffer & ((1 << bits) - 1)) !== 0) return null;
  return Uint8Array.from(bytes);
}

export function serializeHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isSameSecret(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
