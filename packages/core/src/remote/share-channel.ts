import { type Bytes, concatBytes, encodeText, parseBase64Url, serializeBase64Url } from './bytes.ts';
import { REMOTE_PROTOCOL_VERSION } from './handshake.ts';
import { parsePublicKey, serializePublicKey } from './keys.ts';
import { SHARE_FILE_TYPES, type ShareFileType } from './shares.ts';

const HELLO_LABEL = 'shinsa-share-hello-v1';

const WELCOME_LABEL = 'shinsa-share-welcome-v1';

const SESSION_LABEL = 'shinsa-share-v1 server-to-client';

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

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function importShareKey(key: string) {
  const raw = parseBase64Url(key);
  if (!raw || raw.length === 0) return null;
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signShare(key: string, parts: string[]) {
  const hmac = await importShareKey(key);
  if (!hmac) throw new Error('The share key is not valid.');
  return serializeBase64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', hmac, encodeText(parts.join('\n'))))
  );
}

async function verifyShare(key: string, proof: string, parts: string[]) {
  const hmac = await importShareKey(key);
  const signature = parseBase64Url(proof);
  if (!hmac || !signature) return false;
  return crypto.subtle.verify('HMAC', hmac, signature, encodeText(parts.join('\n')));
}

function listWelcomeParts(keys: ShareKeys) {
  return [WELCOME_LABEL, keys.share, keys.clientEphemeral, keys.serverEphemeral];
}

export async function createShareHello(
  share: string,
  key: string,
  ephemeral: CryptoKey
): Promise<ShareHello> {
  const serialized = await serializePublicKey(ephemeral);
  return {
    type: 'share-hello',
    version: REMOTE_PROTOCOL_VERSION,
    share,
    ephemeral: serialized,
    proof: await signShare(key, [HELLO_LABEL, share, serialized]),
  };
}

export function parseShareHello(text: string): ShareHello | null {
  const fields = readFields(text);
  if (fields?.type !== 'share-hello' || fields.version !== REMOTE_PROTOCOL_VERSION) return null;
  if (!(isText(fields.share) && isText(fields.ephemeral) && isText(fields.proof))) return null;
  return {
    type: 'share-hello',
    version: REMOTE_PROTOCOL_VERSION,
    share: fields.share,
    ephemeral: fields.ephemeral,
    proof: fields.proof,
  };
}

export function verifyShareHello(key: string, hello: ShareHello) {
  return verifyShare(key, hello.proof, [HELLO_LABEL, hello.share, hello.ephemeral]);
}

export async function createShareWelcome(key: string, keys: ShareKeys): Promise<ShareWelcome> {
  return {
    type: 'welcome',
    ephemeral: keys.serverEphemeral,
    proof: await signShare(key, listWelcomeParts(keys)),
  };
}

export function parseShareWelcome(text: string): ShareWelcome | null {
  const fields = readFields(text);
  if (fields?.type === 'welcome' && isText(fields.ephemeral) && isText(fields.proof))
    return { type: 'welcome', ephemeral: fields.ephemeral, proof: fields.proof };
  if (fields?.type === 'refused' && isText(fields.reason)) return { type: 'refused', reason: fields.reason };
  return null;
}

export function verifyShareWelcome(key: string, keys: ShareKeys, proof: string) {
  return verifyShare(key, proof, listWelcomeParts(keys));
}

export async function deriveShareSessionKey(
  key: string,
  keys: ShareKeys,
  privateKey: CryptoKey,
  peerEphemeral: string
) {
  const peer = await parsePublicKey(peerEphemeral);
  const raw = parseBase64Url(key);
  if (!(peer && raw)) throw new Error('A share handshake key is not valid.');
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256)
  ) as Bytes;
  const secret = await crypto.subtle.importKey('raw', concatBytes(shared, raw), 'HKDF', false, ['deriveKey']);
  const salt = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      encodeText([SESSION_LABEL, keys.share, keys.clientEphemeral, keys.serverEphemeral].join('\n'))
    )
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encodeText(SESSION_LABEL) },
    secret,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
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

export function parseShareMessage(text: string): ShareMessage | null {
  const fields = readFields(text);
  return fields ? readShareMessage(fields) : null;
}

export function serializeShareMessage(message: ShareMessage) {
  return JSON.stringify(message);
}
