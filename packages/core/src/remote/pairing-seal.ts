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

const PAIRING_SEAL_LABEL = 'shinsa-pairing-seal-v1';

const EPHEMERAL_BYTES = 65;

export const PAIRING_SEAL_IV_BYTES = 12;

async function derivePairingKey(privateKey: CryptoKey, publicKey: CryptoKey, ephemeral: Bytes) {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const secret = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: ephemeral, info: encodeText(PAIRING_SEAL_LABEL) },
    secret,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface PairingSealInput {
  readonly machineKey: string;
  readonly ephemeral: CryptoKeyPair;
  readonly iv: Bytes;
}

export async function sealPairingCredentials(input: PairingSealInput, credentials: MachineCredentials) {
  const { machineKey, iv } = input;
  const recipient = await parsePublicKey(machineKey);
  if (!recipient) throw new Error('The machine key is not a P-256 public key.');
  if (iv.length !== PAIRING_SEAL_IV_BYTES) throw new Error('A pairing seal takes a 12-byte IV.');
  const ephemeral: Bytes = new Uint8Array(await crypto.subtle.exportKey('raw', input.ephemeral.publicKey));
  const key = await derivePairingKey(input.ephemeral.privateKey, recipient, ephemeral);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encodeText(machineKey) },
    key,
    encodeText(JSON.stringify(credentials))
  );
  return serializeBase64Url(concatBytes(ephemeral, iv, new Uint8Array(sealed)));
}

export async function openPairingCredentials(
  machine: { readonly publicKey: string; readonly privateKey: CryptoKey },
  sealed: string
): Promise<MachineCredentials | null> {
  const bytes = parseBase64Url(sealed);
  if (!bytes || bytes.length <= EPHEMERAL_BYTES + PAIRING_SEAL_IV_BYTES) return null;
  const ephemeral = bytes.slice(0, EPHEMERAL_BYTES);
  const sender = await parsePublicKey(serializeBase64Url(ephemeral));
  if (!sender) return null;
  const key = await derivePairingKey(machine.privateKey, sender, ephemeral);
  try {
    const opened = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytes.slice(EPHEMERAL_BYTES, EPHEMERAL_BYTES + PAIRING_SEAL_IV_BYTES),
        additionalData: encodeText(machine.publicKey),
      },
      key,
      bytes.slice(EPHEMERAL_BYTES + PAIRING_SEAL_IV_BYTES)
    );
    return parseMachineCredentials(decodeText(new Uint8Array(opened)));
  } catch {
    return null;
  }
}
