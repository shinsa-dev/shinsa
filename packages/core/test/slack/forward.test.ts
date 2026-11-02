import { describe, expect, test } from 'bun:test';
import {
  createSlackForwardSignature,
  SLACK_FORWARD_WINDOW_MS,
  verifySlackForwardSignature,
} from '../../src/index.ts';

const KEY = 'Y29ubmVjdC1rZXk';

const NOW = 1_800_000_000_000;

describe('the signature on a forwarded mention', () => {
  test('verifies with the same connect key, time and body', async () => {
    const signature = await createSlackForwardSignature(KEY, NOW, '{"a":1}');
    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(
      await verifySlackForwardSignature(KEY, { signature, timestamp: String(NOW) }, '{"a":1}', NOW + 1000)
    ).toBe(true);
  });

  test('fails for another key, a changed body, a changed time or a missing header', async () => {
    const signature = await createSlackForwardSignature(KEY, NOW, '{"a":1}');
    const timestamp = String(NOW);
    expect(await verifySlackForwardSignature('b3RoZXI', { signature, timestamp }, '{"a":1}', NOW)).toBe(
      false
    );
    expect(await verifySlackForwardSignature(KEY, { signature, timestamp }, '{"a":2}', NOW)).toBe(false);
    expect(
      await verifySlackForwardSignature(KEY, { signature, timestamp: String(NOW + 1) }, '{"a":1}', NOW)
    ).toBe(false);
    expect(await verifySlackForwardSignature(KEY, { signature: null, timestamp }, '{"a":1}', NOW)).toBe(
      false
    );
    expect(await verifySlackForwardSignature(KEY, { signature, timestamp: null }, '{"a":1}', NOW)).toBe(
      false
    );
    expect(await verifySlackForwardSignature(KEY, { signature, timestamp: 'soon' }, '{"a":1}', NOW)).toBe(
      false
    );
  });

  test('is refused outside five minutes, so a captured forward cannot be replayed later', async () => {
    const signature = await createSlackForwardSignature(KEY, NOW, 'x');
    const headers = { signature, timestamp: String(NOW) };
    expect(await verifySlackForwardSignature(KEY, headers, 'x', NOW + SLACK_FORWARD_WINDOW_MS)).toBe(true);
    expect(await verifySlackForwardSignature(KEY, headers, 'x', NOW + SLACK_FORWARD_WINDOW_MS + 1)).toBe(
      false
    );
    expect(await verifySlackForwardSignature(KEY, headers, 'x', NOW - SLACK_FORWARD_WINDOW_MS - 1)).toBe(
      false
    );
  });
});
