import { encodeText, isSameSecret, serializeHex } from '../remote/bytes.ts';

export const SLACK_FORWARD_HEADERS = {
  signature: 'x-shinsa-slack-signature',
  timestamp: 'x-shinsa-slack-timestamp',
} as const;

export const SLACK_FORWARD_WINDOW_MS = 5 * 60_000;

const SIGNATURE_VERSION = 'v1';

async function signForward(connectKey: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encodeText(`slack:${connectKey}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const payload = encodeText(`${SIGNATURE_VERSION}:${timestamp}:${body}`);
  return `${SIGNATURE_VERSION}=${serializeHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, payload)))}`;
}

export function createSlackForwardSignature(connectKey: string, timestamp: number, body: string) {
  return signForward(connectKey, String(timestamp), body);
}

export async function verifySlackForwardSignature(
  connectKey: string,
  headers: { signature: string | null; timestamp: string | null },
  body: string,
  now: number
) {
  if (!headers.signature || !headers.timestamp || !/^\d{1,16}$/.test(headers.timestamp)) return false;
  if (Math.abs(now - Number(headers.timestamp)) > SLACK_FORWARD_WINDOW_MS) return false;
  return isSameSecret(await signForward(connectKey, headers.timestamp, body), headers.signature);
}
