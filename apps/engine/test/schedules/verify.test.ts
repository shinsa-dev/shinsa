import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { constantTimeEquals, verifyWebhookSignature } from '../../src/schedules/verify.ts';

const body = new TextEncoder().encode('{"ok":true}');

const hex = createHmac('sha256', 'shh').update(body).digest('hex');

const base64 = createHmac('sha256', 'shh').update(body).digest('base64');

describe('webhook signatures', () => {
  test('accepts a hex signature with its prefix, in either case', () => {
    const signature = { header: 'X-Hub-Signature-256', encoding: 'hex' as const, prefix: 'sha256=' };
    expect(
      verifyWebhookSignature({
        signature,
        secret: 'shh',
        headers: { 'x-hub-signature-256': `sha256=${hex}` },
        body,
      })
    ).toBe(true);
    expect(
      verifyWebhookSignature({
        signature,
        secret: 'shh',
        headers: { 'x-hub-signature-256': ` SHA256=${hex.toUpperCase()} ` },
        body,
      })
    ).toBe(true);
  });

  test('accepts a base64 signature without a prefix', () => {
    const signature = { header: 'x-sig', encoding: 'base64' as const, prefix: '' };
    expect(verifyWebhookSignature({ signature, secret: 'shh', headers: { 'x-sig': base64 }, body })).toBe(
      true
    );
  });

  test('refuses a missing header, a wrong prefix, a wrong secret and a tampered body', () => {
    const signature = { header: 'x-sig', encoding: 'hex' as const, prefix: 'sha256=' };
    expect(verifyWebhookSignature({ signature, secret: 'shh', headers: {}, body })).toBe(false);
    expect(
      verifyWebhookSignature({ signature, secret: 'shh', headers: { 'x-sig': `sha1=${hex}` }, body })
    ).toBe(false);
    expect(
      verifyWebhookSignature({ signature, secret: 'other', headers: { 'x-sig': `sha256=${hex}` }, body })
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        signature,
        secret: 'shh',
        headers: { 'x-sig': `sha256=${hex}` },
        body: new Uint8Array([1]),
      })
    ).toBe(false);
  });

  test('compares in constant time whatever the lengths', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });
});
