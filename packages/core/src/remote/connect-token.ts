import { decodeText, encodeText, parseBase64Url, serializeBase64Url } from './bytes.ts';

export const CONNECT_TOKEN_TTL_MS = 60_000;

export interface ConnectClaim {
  instanceId: string;
  userId: string;
  expiresAt: number;
}

export function importConnectKey(connectKey: string) {
  const raw = parseBase64Url(connectKey);
  if (!raw || raw.length === 0) return null;
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function readClaim(payload: string): ConnectClaim | null {
  try {
    const fields = JSON.parse(payload) as Record<string, unknown>;
    if (typeof fields.i !== 'string' || typeof fields.u !== 'string' || typeof fields.e !== 'number')
      return null;
    return { instanceId: fields.i, userId: fields.u, expiresAt: fields.e };
  } catch {
    return null;
  }
}

export async function createConnectToken(connectKey: string, claim: ConnectClaim) {
  const key = await importConnectKey(connectKey);
  if (!key) throw new Error('The connect key is not valid.');
  const payload = encodeText(JSON.stringify({ i: claim.instanceId, u: claim.userId, e: claim.expiresAt }));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
  return `${serializeBase64Url(payload)}.${serializeBase64Url(signature)}`;
}

export async function verifyConnectToken(
  connectKey: string,
  token: string,
  instanceId: string,
  now: number
): Promise<ConnectClaim | null> {
  const [encoded, encodedSignature, extra] = token.split('.');
  if (encoded === undefined || encodedSignature === undefined || extra !== undefined) return null;
  const payload = parseBase64Url(encoded);
  const signature = parseBase64Url(encodedSignature);
  const key = await importConnectKey(connectKey);
  if (!payload || !signature || !key) return null;
  if (!(await crypto.subtle.verify('HMAC', key, signature, payload))) return null;
  let text: string;
  try {
    text = decodeText(payload);
  } catch {
    return null;
  }
  const claim = readClaim(text);
  if (!claim || claim.instanceId !== instanceId || claim.expiresAt <= now) return null;
  if (claim.expiresAt > now + CONNECT_TOKEN_TTL_MS) return null;
  return claim;
}
