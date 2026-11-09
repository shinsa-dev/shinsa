import { Effect, Option } from 'effect';
import { isRecord, parseJsonRecord } from '../domain/records.ts';
import {
  type Bytes,
  concatBytes,
  decodeText,
  encodeText,
  parseBase64Url,
  serializeBase64Url,
} from './bytes.ts';
import { REMOTE_PROTOCOL_VERSION } from './handshake.ts';
import { parsePublicKey, parseSigningPublicKey, serializePublicKey } from './keys.ts';

const KEY_REQUEST_LABEL = 'shinsa-team-key-request-v1';

const KEY_SEAL_LABEL = 'shinsa-team-key-seal-v1';

const KEY_SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' } as const;

const EPHEMERAL_BYTES = 65;

export const TEAM_KEY_IV_BYTES = 12;

export const TEAM_KEY_RECEIVED = 'This machine holds the team’s key now.';

export const TEAM_KEY_UNWANTED = 'This machine is not waiting for that team’s key.';

export interface TeamKeyRequest {
  ephemeral: string;
  ask: boolean;
  signature: string;
}

export interface TeamKeyRequestSubject {
  teamId: string;
  instanceId: string;
}

export interface TeamKeyDelivery {
  type: 'team-key';
  version: number;
  team: string;
  recipient: string;
  sealed: string;
}

function listRequestBytes(subject: TeamKeyRequestSubject, ephemeral: string, ask: boolean) {
  return encodeText(
    [KEY_REQUEST_LABEL, subject.teamId, subject.instanceId, ephemeral, ask ? 'ask' : 'own'].join('\n')
  );
}

export const createTeamKeyRequest = Effect.fn('createTeamKeyRequest')(function* (
  signingKey: CryptoKey,
  subject: TeamKeyRequestSubject,
  ephemeral: CryptoKey,
  ask: boolean
) {
  const serialized = yield* serializePublicKey(ephemeral);
  const signature = yield* Effect.promise(() =>
    crypto.subtle.sign(KEY_SIGNATURE, signingKey, listRequestBytes(subject, serialized, ask))
  );
  const request: TeamKeyRequest = {
    ephemeral: serialized,
    ask,
    signature: serializeBase64Url(new Uint8Array(signature)),
  };
  return request;
});

export function readTeamKeyRequest(value: unknown): TeamKeyRequest | null {
  if (!isRecord(value)) return null;
  const { ephemeral, ask, signature } = value;
  if (!(typeof ephemeral === 'string' && typeof signature === 'string' && typeof ask === 'boolean'))
    return null;
  return { ephemeral, ask, signature };
}

export function parseTeamKeyRefusal(text: string) {
  const fields = Option.getOrUndefined(parseJsonRecord(text));
  return fields?.type === 'refused' ? readTeamKeyRequest(fields.keyRequest) : null;
}

export const verifyTeamKeyRequest = Effect.fn('verifyTeamKeyRequest')(function* (
  signingKey: string,
  subject: TeamKeyRequestSubject,
  request: TeamKeyRequest
) {
  const key = yield* parseSigningPublicKey(signingKey);
  const signature = parseBase64Url(request.signature);
  if (!(key && signature)) return false;
  return yield* Effect.promise(() =>
    crypto.subtle.verify(
      KEY_SIGNATURE,
      key,
      signature,
      listRequestBytes(subject, request.ephemeral, request.ask)
    )
  );
});

const deriveSealKey = Effect.fn('deriveSealKey')(function* (
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  salt: Bytes
) {
  const shared = yield* Effect.promise(() =>
    crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  );
  const secret = yield* Effect.promise(() =>
    crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  );
  return yield* Effect.promise(() =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: encodeText(KEY_SEAL_LABEL) },
      secret,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  );
});

function resolveSealData(teamId: string, recipient: string) {
  return encodeText(`${teamId}\n${recipient}`);
}

export interface TeamKeySealInput {
  readonly teamId: string;
  readonly recipient: string;
  readonly ephemeral: CryptoKeyPair;
  readonly iv: Bytes;
}

export const sealTeamKey = Effect.fn('sealTeamKey')(function* (input: TeamKeySealInput, key: string) {
  const recipient = yield* parsePublicKey(input.recipient);
  if (!recipient || input.iv.length !== TEAM_KEY_IV_BYTES) return null;
  const sender = new Uint8Array(
    yield* Effect.promise(() => crypto.subtle.exportKey('raw', input.ephemeral.publicKey))
  );
  const sealKey = yield* deriveSealKey(input.ephemeral.privateKey, recipient, sender);
  const sealed = yield* Effect.promise(() =>
    crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: input.iv, additionalData: resolveSealData(input.teamId, input.recipient) },
      sealKey,
      encodeText(key)
    )
  );
  const delivery: TeamKeyDelivery = {
    type: 'team-key',
    version: REMOTE_PROTOCOL_VERSION,
    team: input.teamId,
    recipient: input.recipient,
    sealed: serializeBase64Url(concatBytes(sender, input.iv, new Uint8Array(sealed))),
  };
  return delivery;
});

export function parseTeamKeyDelivery(text: string): TeamKeyDelivery | null {
  const fields = Option.getOrUndefined(parseJsonRecord(text));
  if (fields?.type !== 'team-key' || fields.version !== REMOTE_PROTOCOL_VERSION) return null;
  const { team, recipient, sealed } = fields;
  if (!(typeof team === 'string' && typeof recipient === 'string' && typeof sealed === 'string')) return null;
  return { type: 'team-key', version: REMOTE_PROTOCOL_VERSION, team, recipient, sealed };
}

export const openTeamKey = Effect.fn('openTeamKey')(function* (
  privateKey: CryptoKey,
  delivery: TeamKeyDelivery
) {
  const bytes = parseBase64Url(delivery.sealed);
  if (!bytes || bytes.length <= EPHEMERAL_BYTES + TEAM_KEY_IV_BYTES) return null;
  const senderBytes = bytes.slice(0, EPHEMERAL_BYTES);
  const sender = yield* parsePublicKey(serializeBase64Url(senderBytes));
  if (!sender) return null;
  const sealKey = yield* deriveSealKey(privateKey, sender, senderBytes);
  const opened = yield* Effect.tryPromise(() =>
    crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytes.slice(EPHEMERAL_BYTES, EPHEMERAL_BYTES + TEAM_KEY_IV_BYTES),
        additionalData: resolveSealData(delivery.team, delivery.recipient),
      },
      sealKey,
      bytes.slice(EPHEMERAL_BYTES + TEAM_KEY_IV_BYTES)
    )
  ).pipe(Effect.option);
  return Option.isSome(opened) ? decodeText(new Uint8Array(opened.value)) : null;
});
