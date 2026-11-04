import { REMOTE_KEY_ALGORITHM } from '@shinsa/core';
import { Effect } from 'effect';

export const createEphemeralKeys = Effect.promise(
  () => crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits']) as Promise<CryptoKeyPair>
);
