import { Effect } from 'effect';
import { MINUTE_MS } from '../domain/time.ts';
import { encodeText, isSameSecret, serializeHex } from '../remote/bytes.ts';

export const SLACK_FORWARD_HEADERS = {
  signature: 'x-shinsa-slack-signature',
  timestamp: 'x-shinsa-slack-timestamp',
} as const;

export const SLACK_FORWARD_WINDOW_MS = 5 * MINUTE_MS;

const SIGNATURE_VERSION = 'v1';

const signForward = Effect.fn('signForward')(function* (connectKey: string, timestamp: string, body: string) {
  const key = yield* Effect.promise(() =>
    crypto.subtle.importKey(
      'raw',
      encodeText(`slack:${connectKey}`),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
  );
  const payload = encodeText(`${SIGNATURE_VERSION}:${timestamp}:${body}`);
  const signature = yield* Effect.promise(() => crypto.subtle.sign('HMAC', key, payload));
  return `${SIGNATURE_VERSION}=${serializeHex(new Uint8Array(signature))}`;
});

export function createSlackForwardSignature(connectKey: string, timestamp: number, body: string) {
  return signForward(connectKey, String(timestamp), body);
}

export const verifySlackForwardSignature = Effect.fn('verifySlackForwardSignature')(function* (
  connectKey: string,
  headers: { signature: string | null; timestamp: string | null },
  body: string,
  now: number
) {
  if (!headers.signature || !headers.timestamp || !/^\d{1,16}$/.test(headers.timestamp)) return false;
  if (Math.abs(now - Number(headers.timestamp)) > SLACK_FORWARD_WINDOW_MS) return false;
  return isSameSecret(yield* signForward(connectKey, headers.timestamp, body), headers.signature);
});
