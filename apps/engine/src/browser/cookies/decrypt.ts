import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import {
  COOKIE_IV,
  COOKIE_KEY_BYTES,
  COOKIE_KEY_ITERATIONS,
  COOKIE_SALT,
  ENCRYPTED_PREFIX,
  HOST_DIGEST_BYTES,
} from './schema.ts';

export function createCookieKey(password: string) {
  return pbkdf2Sync(password, COOKIE_SALT, COOKIE_KEY_ITERATIONS, COOKIE_KEY_BYTES, 'sha1');
}

export function decryptCookieValue(key: Uint8Array, encrypted: Uint8Array, hostKey: string) {
  const prefix = new TextDecoder().decode(encrypted.subarray(0, ENCRYPTED_PREFIX.length));
  if (prefix !== ENCRYPTED_PREFIX) return null;
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, COOKIE_IV);
    const plain = Buffer.concat([
      decipher.update(encrypted.subarray(ENCRYPTED_PREFIX.length)),
      decipher.final(),
    ]);
    const digest = createHash('sha256').update(hostKey).digest();
    const signed = plain.length >= HOST_DIGEST_BYTES && plain.subarray(0, HOST_DIGEST_BYTES).equals(digest);
    return plain.subarray(signed ? HOST_DIGEST_BYTES : 0).toString('utf8');
  } catch {
    return null;
  }
}
