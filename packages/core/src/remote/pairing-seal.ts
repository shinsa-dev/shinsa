import { Effect, Option } from 'effect';
import {
  type Bytes,
  concatBytes,
  decodeText,
  encodeText,
  parseBase64Url,
  serializeBase64Url,
} from './bytes.ts';
import { type MachineCredentials, parseMachineCredentials } from './contract.ts';
import { parsePublicKey } from './keys.ts';
import { RemoteKeyInvalid } from './schema.ts';

const PAIRING_SEAL_LABEL = 'shinsa-pairing-seal-v1';

const EPHEMERAL_BYTES = 65;

export const PAIRING_SEAL_IV_BYTES = 12;

const selectCredentials = Option.liftThrowable((opened: Bytes) =>
  parseMachineCredentials(decodeText(opened))
);

const derivePairingKey = Effect.fn('derivePairingKey')(function* (
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  ephemeral: Bytes
) {
  const shared = yield* Effect.promise(() =>
    crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  );
  const secret = yield* Effect.promise(() =>
    crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  );
  return yield* Effect.promise(() =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: ephemeral, info: encodeText(PAIRING_SEAL_LABEL) },
      secret,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  );
});

export interface PairingSealInput {
  readonly machineKey: string;
  readonly ephemeral: CryptoKeyPair;
  readonly iv: Bytes;
}

export const sealPairingCredentials = Effect.fn('sealPairingCredentials')(function* (
  input: PairingSealInput,
  credentials: MachineCredentials
) {
  const { machineKey, iv } = input;
  const recipient = yield* parsePublicKey(machineKey);
  if (!recipient)
    return yield* new RemoteKeyInvalid({ message: 'The machine key is not a P-256 public key.' });
  if (iv.length !== PAIRING_SEAL_IV_BYTES)
    return yield* Effect.die(new Error('A pairing seal takes a 12-byte IV.'));
  const ephemeral: Bytes = new Uint8Array(
    yield* Effect.promise(() => crypto.subtle.exportKey('raw', input.ephemeral.publicKey))
  );
  const key = yield* derivePairingKey(input.ephemeral.privateKey, recipient, ephemeral);
  const sealed = yield* Effect.promise(() =>
    crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encodeText(machineKey) },
      key,
      encodeText(JSON.stringify(credentials))
    )
  );
  return serializeBase64Url(concatBytes(ephemeral, iv, new Uint8Array(sealed)));
});

export const openPairingCredentials = Effect.fn('openPairingCredentials')(function* (
  machine: { readonly publicKey: string; readonly privateKey: CryptoKey },
  sealed: string
) {
  const bytes = Option.getOrNull(parseBase64Url(sealed));
  if (!bytes || bytes.length <= EPHEMERAL_BYTES + PAIRING_SEAL_IV_BYTES) return null;
  const ephemeral = bytes.slice(0, EPHEMERAL_BYTES);
  const sender = yield* parsePublicKey(serializeBase64Url(ephemeral));
  if (!sender) return null;
  const key = yield* derivePairingKey(machine.privateKey, sender, ephemeral);
  const opened = yield* Effect.tryPromise(() =>
    crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytes.slice(EPHEMERAL_BYTES, EPHEMERAL_BYTES + PAIRING_SEAL_IV_BYTES),
        additionalData: encodeText(machine.publicKey),
      },
      key,
      bytes.slice(EPHEMERAL_BYTES + PAIRING_SEAL_IV_BYTES)
    )
  ).pipe(Effect.option);
  if (Option.isNone(opened)) return null;
  return Option.getOrNull(Option.flatten(selectCredentials(new Uint8Array(opened.value))));
});
