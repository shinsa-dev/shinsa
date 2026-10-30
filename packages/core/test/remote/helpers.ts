import { REMOTE_KEY_ALGORITHM } from '../../src/remote/keys.ts';

export function createKeyPair() {
  return crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits']) as Promise<CryptoKeyPair>;
}

export function createAesKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
