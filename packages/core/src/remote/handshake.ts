import { type Bytes, concatBytes, encodeText, parseBase64Url, serializeBase64Url } from './bytes.ts';
import { parsePublicKey, serializePublicKey } from './keys.ts';

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
}

export type ServerHello = { type: 'welcome'; ephemeral: string } | { type: 'refused'; reason: string };

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

function readFields(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function parseClientHello(text: string): ClientHello | null {
  const fields = readFields(text);
  if (fields?.type !== 'hello' || fields.version !== REMOTE_PROTOCOL_VERSION) return null;
  if (typeof fields.device !== 'string' || typeof fields.ephemeral !== 'string') return null;
  if (fields.enroll !== null && typeof fields.enroll !== 'string') return null;
  return {
    type: 'hello',
    version: REMOTE_PROTOCOL_VERSION,
    device: fields.device,
    ephemeral: fields.ephemeral,
    enroll: fields.enroll,
  };
}

export function parseServerHello(text: string): ServerHello | null {
  const fields = readFields(text);
  if (fields?.type === 'welcome' && typeof fields.ephemeral === 'string')
    return { type: 'welcome', ephemeral: fields.ephemeral };
  if (fields?.type === 'refused' && typeof fields.reason === 'string')
    return { type: 'refused', reason: fields.reason };
  return null;
}

async function deriveShared(privateKey: CryptoKey, publicKey: CryptoKey): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256));
}

async function resolveTranscript(keys: HandshakeKeys): Promise<Bytes> {
  const text = [PROTOCOL_LABEL, keys.machine, keys.device, keys.clientEphemeral, keys.serverEphemeral].join(
    '\n'
  );
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encodeText(text)));
}

function deriveDirectionKey(secret: CryptoKey, transcript: Bytes, direction: string) {
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: transcript, info: encodeText(`${PROTOCOL_LABEL} ${direction}`) },
    secret,
    SESSION_KEY,
    false,
    ['encrypt', 'decrypt']
  );
}

async function deriveSessionKeys(keys: HandshakeKeys, ee: Bytes, es: Bytes, se: Bytes) {
  const secret = await crypto.subtle.importKey('raw', concatBytes(ee, es, se), 'HKDF', false, ['deriveKey']);
  const transcript = await resolveTranscript(keys);
  return {
    clientToServer: await deriveDirectionKey(secret, transcript, 'client-to-server'),
    serverToClient: await deriveDirectionKey(secret, transcript, 'server-to-client'),
  };
}

async function parseHandshakeKey(text: string) {
  const key = await parsePublicKey(text);
  if (!key) throw new Error('A handshake key is not a P-256 public key.');
  return key;
}

export async function deriveClientSession(input: ClientSessionInput): Promise<SessionKeys> {
  const serverEphemeral = await parseHandshakeKey(input.keys.serverEphemeral);
  const ee = await deriveShared(input.clientEphemeralPrivateKey, serverEphemeral);
  const es = await deriveShared(input.clientEphemeralPrivateKey, input.machinePublicKey);
  const se = await deriveShared(input.devicePrivateKey, serverEphemeral);
  const keys = await deriveSessionKeys(input.keys, ee, es, se);
  return { send: keys.clientToServer, receive: keys.serverToClient };
}

export async function deriveServerSession(input: ServerSessionInput): Promise<SessionKeys> {
  const clientEphemeral = await parseHandshakeKey(input.keys.clientEphemeral);
  const device = await parseHandshakeKey(input.keys.device);
  const ee = await deriveShared(input.serverEphemeralPrivateKey, clientEphemeral);
  const es = await deriveShared(input.machinePrivateKey, clientEphemeral);
  const se = await deriveShared(input.serverEphemeralPrivateKey, device);
  const keys = await deriveSessionKeys(input.keys, ee, es, se);
  return { send: keys.serverToClient, receive: keys.clientToServer };
}

function importEnrollSecret(secret: string) {
  const raw = parseBase64Url(secret);
  if (!raw || raw.length === 0) return null;
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function resolveEnrollMessage(machine: string, device: string, clientEphemeral: string) {
  return encodeText([ENROLL_LABEL, machine, device, clientEphemeral].join('\n'));
}

export async function createEnrollProof(
  secret: string,
  keys: Pick<HandshakeKeys, 'machine' | 'device' | 'clientEphemeral'>
) {
  const key = await importEnrollSecret(secret);
  if (!key) throw new Error('The enrollment secret is not valid.');
  const message = resolveEnrollMessage(keys.machine, keys.device, keys.clientEphemeral);
  return serializeBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, message)));
}

export async function verifyEnrollProof(
  secret: string,
  proof: string,
  keys: Pick<HandshakeKeys, 'machine' | 'device' | 'clientEphemeral'>
) {
  const key = await importEnrollSecret(secret);
  const signature = parseBase64Url(proof);
  if (!key || !signature) return false;
  const message = resolveEnrollMessage(keys.machine, keys.device, keys.clientEphemeral);
  return crypto.subtle.verify('HMAC', key, signature, message);
}

export async function createClientHello(
  device: CryptoKey,
  ephemeral: CryptoKey,
  enroll: string | null
): Promise<ClientHello> {
  return {
    type: 'hello',
    version: REMOTE_PROTOCOL_VERSION,
    device: await serializePublicKey(device),
    ephemeral: await serializePublicKey(ephemeral),
    enroll,
  };
}
