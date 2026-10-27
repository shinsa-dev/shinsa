import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookSignature } from '@shinsa/core';

export function constantTimeEquals(a: string, b: string) {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

export function verifyWebhookSignature(input: {
  signature: WebhookSignature;
  secret: string;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}) {
  const received = input.headers[input.signature.header.toLowerCase()];
  if (received === undefined) return false;
  const value = received.trim();
  const prefix = input.signature.prefix;
  if (prefix !== '' && !value.toLowerCase().startsWith(prefix.toLowerCase())) return false;
  const digest = createHmac('sha256', input.secret).update(input.body).digest();
  const expected = input.signature.encoding === 'hex' ? digest.toString('hex') : digest.toString('base64');
  const candidate = value.slice(prefix.length);
  return constantTimeEquals(
    input.signature.encoding === 'hex' ? candidate.toLowerCase() : candidate,
    expected
  );
}
