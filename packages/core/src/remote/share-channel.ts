import { Effect, Option } from 'effect';
import { isText, parseJsonRecord } from '../domain/records.ts';
import { type Bytes, concatBytes, encodeText, parseBase64Url, serializeBase64Url } from './bytes.ts';
import { REMOTE_PROTOCOL_VERSION } from './handshake.ts';
import { parsePublicKey, serializePublicKey } from './keys.ts';
import { RemoteKeyInvalid } from './schema.ts';
import { SHARE_FILE_TYPES, type ShareFileType } from './shares.ts';
import { findHmacKey, importHmacKey, signHmac, verifyHmac } from './tokens.ts';

const SHARE_HELLO_LABEL = 'shinsa-share-hello-v1';

const SHARE_WELCOME_LABEL = 'shinsa-share-welcome-v1';

const SHARE_SESSION_LABEL = 'shinsa-share-v1 server-to-client';

export interface ShareHello {
  type: 'share-hello';
  version: number;
  share: string;
  ephemeral: string;
  proof: string;
}

export type ShareWelcome =
  | { type: 'welcome'; ephemeral: string; proof: string }
  | { type: 'refused'; reason: string };

export type ShareMessage =
  | { t: 'view'; data: string }
  | { t: 'file'; id: string; version: string; type: ShareFileType }
  | { t: 'body'; id: string; chunk: string }
  | { t: 'end'; id: string }
  | { t: 'closed'; reason: string };

interface ShareKeys {
  share: string;
  clientEphemeral: string;
  serverEphemeral: string;
}

export const signChannelProof = Effect.fn('signChannelProof')(function* (key: string, parts: string[]) {
  const hmac = yield* findHmacKey(key, 'The channel key is not valid.');
  return serializeBase64Url(yield* signHmac(hmac, encodeText(parts.join('\n'))));
});

export const verifyChannelProof = Effect.fn('verifyChannelProof')(function* (
  key: string,
  proof: string,
  parts: string[]
) {
  const hmac = yield* importHmacKey(key);
  const signature = Option.getOrNull(parseBase64Url(proof));
  if (!hmac || !signature) return false;
  return yield* verifyHmac(hmac, signature, encodeText(parts.join('\n')));
});

export const deriveChannelSessionKey = Effect.fn('deriveChannelSessionKey')(function* (
  label: string,
  key: string,
  parts: string[],
  privateKey: CryptoKey,
  peerEphemeral: string
) {
  const peer = yield* parsePublicKey(peerEphemeral);
  const raw = Option.getOrNull(parseBase64Url(key));
  if (!(peer && raw))
    return yield* new RemoteKeyInvalid({ message: 'A channel handshake key is not valid.' });
  const shared = new Uint8Array(
    yield* Effect.promise(() => crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256))
  ) as Bytes;
  const secret = yield* Effect.promise(() =>
    crypto.subtle.importKey('raw', concatBytes(shared, raw), 'HKDF', false, ['deriveKey'])
  );
  const salt = new Uint8Array(
    yield* Effect.promise(() => crypto.subtle.digest('SHA-256', encodeText([label, ...parts].join('\n'))))
  );
  return yield* Effect.promise(() =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: encodeText(label) },
      secret,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  );
});

function listShareWelcomeParts(keys: ShareKeys) {
  return [SHARE_WELCOME_LABEL, keys.share, keys.clientEphemeral, keys.serverEphemeral];
}

export const createShareHello = Effect.fn('createShareHello')(function* (
  share: string,
  key: string,
  ephemeral: CryptoKey
) {
  const serialized = yield* serializePublicKey(ephemeral);
  const hello: ShareHello = {
    type: 'share-hello',
    version: REMOTE_PROTOCOL_VERSION,
    share,
    ephemeral: serialized,
    proof: yield* signChannelProof(key, [SHARE_HELLO_LABEL, share, serialized]),
  };
  return hello;
});

export function parseShareHello(text: string): Option.Option<ShareHello> {
  const fields = Option.getOrUndefined(parseJsonRecord(text));
  if (fields?.type !== 'share-hello' || fields.version !== REMOTE_PROTOCOL_VERSION) return Option.none();
  if (!(isText(fields.share) && isText(fields.ephemeral) && isText(fields.proof))) return Option.none();
  return Option.some({
    type: 'share-hello',
    version: REMOTE_PROTOCOL_VERSION,
    share: fields.share,
    ephemeral: fields.ephemeral,
    proof: fields.proof,
  });
}

export function verifyShareHello(key: string, hello: ShareHello) {
  return verifyChannelProof(key, hello.proof, [SHARE_HELLO_LABEL, hello.share, hello.ephemeral]);
}

export const createShareWelcome = Effect.fn('createShareWelcome')(function* (key: string, keys: ShareKeys) {
  const welcome: ShareWelcome = {
    type: 'welcome',
    ephemeral: keys.serverEphemeral,
    proof: yield* signChannelProof(key, listShareWelcomeParts(keys)),
  };
  return welcome;
});

export function parseShareWelcome(text: string): Option.Option<ShareWelcome> {
  const fields = Option.getOrUndefined(parseJsonRecord(text));
  if (fields?.type === 'welcome' && isText(fields.ephemeral) && isText(fields.proof))
    return Option.some({ type: 'welcome', ephemeral: fields.ephemeral, proof: fields.proof });
  if (fields?.type === 'refused' && isText(fields.reason))
    return Option.some({ type: 'refused', reason: fields.reason });
  return Option.none();
}

export function verifyShareWelcome(key: string, keys: ShareKeys, proof: string) {
  return verifyChannelProof(key, proof, listShareWelcomeParts(keys));
}

export function deriveShareSessionKey(
  key: string,
  keys: ShareKeys,
  privateKey: CryptoKey,
  peerEphemeral: string
) {
  const parts = [keys.share, keys.clientEphemeral, keys.serverEphemeral];
  return deriveChannelSessionKey(SHARE_SESSION_LABEL, key, parts, privateKey, peerEphemeral);
}

function readShareMessage(fields: Record<string, unknown>): ShareMessage | null {
  const { id } = fields;
  switch (fields.t) {
    case 'view':
      return isText(fields.data) ? { t: 'view', data: fields.data } : null;
    case 'file':
      if (!(isText(id) && isText(fields.version) && isText(fields.type))) return null;
      if (!(SHARE_FILE_TYPES as readonly string[]).includes(fields.type)) return null;
      return { t: 'file', id, version: fields.version, type: fields.type as ShareFileType };
    case 'body':
      return isText(id) && isText(fields.chunk) ? { t: 'body', id, chunk: fields.chunk } : null;
    case 'end':
      return isText(id) ? { t: 'end', id } : null;
    case 'closed':
      return isText(fields.reason) ? { t: 'closed', reason: fields.reason } : null;
    default:
      return null;
  }
}

export function parseShareMessage(text: string): Option.Option<ShareMessage> {
  return Option.flatMapNullishOr(parseJsonRecord(text), readShareMessage);
}

export function serializeShareMessage(message: ShareMessage) {
  return JSON.stringify(message);
}
