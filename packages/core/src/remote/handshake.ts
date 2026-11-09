import { Effect, Option } from 'effect';
import { parseJsonRecord } from '../domain/records.ts';
import { type Bytes, concatBytes, encodeText, parseBase64Url, serializeBase64Url } from './bytes.ts';
import { CHANNEL_COMPRESSION, type ChannelCompression } from './frames.ts';
import { parsePublicKey, serializePublicKey } from './keys.ts';
import { RemoteKeyInvalid } from './schema.ts';
import { findHmacKey, importHmacKey, signHmac, verifyHmac } from './tokens.ts';

export const REMOTE_PROTOCOL_VERSION = 1;

const PROTOCOL_LABEL = 'shinsa-remote-v1';

const ENROLL_LABEL = 'shinsa-remote-enroll-v1';

const SESSION_KEY = { name: 'AES-GCM', length: 256 } as const;

export interface ClientHello {
  type: 'hello';
  version: number;
  device: string;
  ephemeral: string;
  enroll: string | null;
  name: string | null;
  compression: ChannelCompression[];
}

export const DEVICE_NAME_LIMIT = 60;

export type ServerHello =
  | { type: 'welcome'; ephemeral: string; compression: ChannelCompression | null }
  | { type: 'pending' }
  | { type: 'refused'; reason: string };

export interface SessionKeys {
  send: CryptoKey;
  receive: CryptoKey;
}

export interface HandshakeKeys {
  machine: string;
  device: string;
  clientEphemeral: string;
  serverEphemeral: string;
}

interface ClientSessionInput {
  keys: HandshakeKeys;
  machinePublicKey: CryptoKey;
  devicePrivateKey: CryptoKey;
  clientEphemeralPrivateKey: CryptoKey;
}

interface ServerSessionInput {
  keys: HandshakeKeys;
  machinePrivateKey: CryptoKey;
  serverEphemeralPrivateKey: CryptoKey;
}

export function parseClientHello(text: string): Option.Option<ClientHello> {
  const fields = Option.getOrUndefined(parseJsonRecord(text));
  if (fields?.type !== 'hello' || fields.version !== REMOTE_PROTOCOL_VERSION) return Option.none();
  if (typeof fields.device !== 'string' || typeof fields.ephemeral !== 'string') return Option.none();
  if (fields.enroll !== null && typeof fields.enroll !== 'string') return Option.none();
  const name = typeof fields.name === 'string' ? fields.name.trim().slice(0, DEVICE_NAME_LIMIT) : '';
  return Option.some({
    type: 'hello',
    version: REMOTE_PROTOCOL_VERSION,
    device: fields.device,
    ephemeral: fields.ephemeral,
    enroll: fields.enroll,
    name: name || null,
    compression:
      Array.isArray(fields.compression) && fields.compression.includes(CHANNEL_COMPRESSION)
        ? [CHANNEL_COMPRESSION]
        : [],
  });
}

export function resolveCompression(hello: ClientHello): Option.Option<ChannelCompression> {
  return hello.compression.includes(CHANNEL_COMPRESSION)
    ? Option.some(CHANNEL_COMPRESSION)
    : Option.none<ChannelCompression>();
}

export function parseServerHello(text: string): Option.Option<ServerHello> {
  const fields = Option.getOrUndefined(parseJsonRecord(text));
  if (fields?.type === 'welcome' && typeof fields.ephemeral === 'string')
    return Option.some({
      type: 'welcome',
      ephemeral: fields.ephemeral,
      compression: fields.compression === CHANNEL_COMPRESSION ? CHANNEL_COMPRESSION : null,
    });
  if (fields?.type === 'pending') return Option.some({ type: 'pending' });
  if (fields?.type === 'refused' && typeof fields.reason === 'string')
    return Option.some({ type: 'refused', reason: fields.reason });
  return Option.none();
}

function deriveShared(privateKey: CryptoKey, publicKey: CryptoKey) {
  return Effect.promise(() =>
    crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  ).pipe(Effect.map((bits): Bytes => new Uint8Array(bits)));
}

function resolveTranscript(keys: HandshakeKeys) {
  const text = [PROTOCOL_LABEL, keys.machine, keys.device, keys.clientEphemeral, keys.serverEphemeral].join(
    '\n'
  );
  return Effect.promise(() => crypto.subtle.digest('SHA-256', encodeText(text))).pipe(
    Effect.map((digest): Bytes => new Uint8Array(digest))
  );
}

function deriveDirectionKey(secret: CryptoKey, transcript: Bytes, direction: string) {
  return Effect.promise(() =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: transcript, info: encodeText(`${PROTOCOL_LABEL} ${direction}`) },
      secret,
      SESSION_KEY,
      false,
      ['encrypt', 'decrypt']
    )
  );
}

const deriveSessionKeys = Effect.fn('deriveSessionKeys')(function* (
  keys: HandshakeKeys,
  ee: Bytes,
  es: Bytes,
  se: Bytes
) {
  const secret = yield* Effect.promise(() =>
    crypto.subtle.importKey('raw', concatBytes(ee, es, se), 'HKDF', false, ['deriveKey'])
  );
  const transcript = yield* resolveTranscript(keys);
  return {
    clientToServer: yield* deriveDirectionKey(secret, transcript, 'client-to-server'),
    serverToClient: yield* deriveDirectionKey(secret, transcript, 'server-to-client'),
  };
});

const findHandshakeKey = Effect.fn('findHandshakeKey')(function* (text: string) {
  const key = yield* parsePublicKey(text);
  if (!key) return yield* new RemoteKeyInvalid({ message: 'A handshake key is not a P-256 public key.' });
  return key;
});

export const deriveClientSession = Effect.fn('deriveClientSession')(function* (input: ClientSessionInput) {
  const serverEphemeral = yield* findHandshakeKey(input.keys.serverEphemeral);
  const ee = yield* deriveShared(input.clientEphemeralPrivateKey, serverEphemeral);
  const es = yield* deriveShared(input.clientEphemeralPrivateKey, input.machinePublicKey);
  const se = yield* deriveShared(input.devicePrivateKey, serverEphemeral);
  const keys = yield* deriveSessionKeys(input.keys, ee, es, se);
  return { send: keys.clientToServer, receive: keys.serverToClient } satisfies SessionKeys;
});

export const deriveServerSession = Effect.fn('deriveServerSession')(function* (input: ServerSessionInput) {
  const clientEphemeral = yield* findHandshakeKey(input.keys.clientEphemeral);
  const device = yield* findHandshakeKey(input.keys.device);
  const ee = yield* deriveShared(input.serverEphemeralPrivateKey, clientEphemeral);
  const es = yield* deriveShared(input.machinePrivateKey, clientEphemeral);
  const se = yield* deriveShared(input.serverEphemeralPrivateKey, device);
  const keys = yield* deriveSessionKeys(input.keys, ee, es, se);
  return { send: keys.serverToClient, receive: keys.clientToServer } satisfies SessionKeys;
});

function resolveEnrollMessage(machine: string, device: string, clientEphemeral: string) {
  return encodeText([ENROLL_LABEL, machine, device, clientEphemeral].join('\n'));
}

export const createEnrollProof = Effect.fn('createEnrollProof')(function* (
  secret: string,
  keys: Pick<HandshakeKeys, 'machine' | 'device' | 'clientEphemeral'>
) {
  const key = yield* findHmacKey(secret, 'The enrollment secret is not valid.');
  const message = resolveEnrollMessage(keys.machine, keys.device, keys.clientEphemeral);
  return serializeBase64Url(yield* signHmac(key, message));
});

export const verifyEnrollProof = Effect.fn('verifyEnrollProof')(function* (
  secret: string,
  proof: string,
  keys: Pick<HandshakeKeys, 'machine' | 'device' | 'clientEphemeral'>
) {
  const key = yield* importHmacKey(secret);
  const signature = Option.getOrNull(parseBase64Url(proof));
  if (!key || !signature) return false;
  return yield* verifyHmac(
    key,
    signature,
    resolveEnrollMessage(keys.machine, keys.device, keys.clientEphemeral)
  );
});

export const createClientHello = Effect.fn('createClientHello')(function* (
  device: CryptoKey,
  ephemeral: CryptoKey,
  enroll: string | null,
  name: string | null = null,
  compression: ChannelCompression[] = []
) {
  const hello: ClientHello = {
    type: 'hello',
    version: REMOTE_PROTOCOL_VERSION,
    device: yield* serializePublicKey(device),
    ephemeral: yield* serializePublicKey(ephemeral),
    enroll,
    name,
    compression,
  };
  return hello;
});
