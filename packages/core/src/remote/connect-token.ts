import { parseJsonRecord } from '../domain/records.ts';
import { MINUTE_MS } from '../domain/time.ts';
import { concatBytes, decodeText, encodeText, parseBase64Url, serializeBase64Url } from './bytes.ts';
import { CONNECT_CHANNELS, CONNECT_NONCE_PATTERN, type ConnectChannel } from './schema.ts';

export const CONNECT_TOKEN_TTL_MS = MINUTE_MS;

const CONNECT_LABEL = encodeText('shinsa-connect-v1\n');

export interface ConnectClaim {
  instanceId: string;
  userId: string;
  channel: ConnectChannel;
  nonce: string;
  expiresAt: number;
}

export interface ConnectAudience {
  instanceId: string;
  channel: ConnectChannel;
}

export function importConnectKey(connectKey: string) {
  const raw = parseBase64Url(connectKey);
  if (!raw || raw.length === 0) return null;
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function isConnectChannel(value: unknown): value is ConnectChannel {
  return CONNECT_CHANNELS.some((channel) => channel === value);
}

function readClaim(payload: string): ConnectClaim | null {
  const fields = parseJsonRecord(payload);
  if (!fields) return null;
  const { i, u, c, n, e } = fields;
  if (typeof i !== 'string' || typeof u !== 'string' || !isConnectChannel(c)) return null;
  if (typeof n !== 'string' || !CONNECT_NONCE_PATTERN.test(n) || typeof e !== 'number' || !Number.isFinite(e))
    return null;
  return { instanceId: i, userId: u, channel: c, nonce: n, expiresAt: e };
}

export async function createConnectToken(connectKey: string, claim: ConnectClaim) {
  const key = await importConnectKey(connectKey);
  if (!key) throw new Error('The connect key is not valid.');
  if (!CONNECT_NONCE_PATTERN.test(claim.nonce)) throw new Error('A connect token needs a random nonce.');
  const payload = encodeText(
    JSON.stringify({
      i: claim.instanceId,
      u: claim.userId,
      c: claim.channel,
      n: claim.nonce,
      e: claim.expiresAt,
    })
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, concatBytes(CONNECT_LABEL, payload))
  );
  return `${serializeBase64Url(payload)}.${serializeBase64Url(signature)}`;
}

export interface LegacyConnectClaim {
  instanceId: string;
  userId: string;
  expiresAt: number;
}

export async function createLegacyConnectToken(connectKey: string, claim: LegacyConnectClaim) {
  const key = await importConnectKey(connectKey);
  if (!key) throw new Error('The connect key is not valid.');
  const payload = encodeText(JSON.stringify({ i: claim.instanceId, u: claim.userId, e: claim.expiresAt }));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
  return `${serializeBase64Url(payload)}.${serializeBase64Url(signature)}`;
}

export async function verifyConnectToken(
  connectKey: string,
  token: string,
  audience: ConnectAudience,
  now: number
): Promise<ConnectClaim | null> {
  const [encoded, encodedSignature, extra] = token.split('.');
  if (encoded === undefined || encodedSignature === undefined || extra !== undefined) return null;
  const payload = parseBase64Url(encoded);
  const signature = parseBase64Url(encodedSignature);
  const key = await importConnectKey(connectKey);
  if (!payload || !signature || !key) return null;
  if (!(await crypto.subtle.verify('HMAC', key, signature, concatBytes(CONNECT_LABEL, payload)))) return null;
  let text: string;
  try {
    text = decodeText(payload);
  } catch {
    return null;
  }
  const claim = readClaim(text);
  if (!claim || claim.instanceId !== audience.instanceId || claim.channel !== audience.channel) return null;
  if (claim.expiresAt <= now || claim.expiresAt > now + CONNECT_TOKEN_TTL_MS) return null;
  return claim;
}
