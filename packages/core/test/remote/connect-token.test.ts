import { describe, expect, test } from 'bun:test';
import { encodeText, serializeBase64Url } from '../../src/remote/bytes.ts';
import {
  CONNECT_TOKEN_TTL_MS,
  createConnectToken,
  verifyConnectToken,
} from '../../src/remote/connect-token.ts';

const KEY = serializeBase64Url(new Uint8Array(32).fill(3));

const NOW = 1_800_000_000_000;

const CLAIM = { instanceId: 'abc', userId: '42', expiresAt: NOW + CONNECT_TOKEN_TTL_MS };

async function signRaw(payload: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(32).fill(3),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
  return `${serializeBase64Url(payload)}.${serializeBase64Url(signature)}`;
}

describe('connect tokens', () => {
  test('verify for their instance until they expire', async () => {
    const token = await createConnectToken(KEY, CLAIM);
    expect(await verifyConnectToken(KEY, token, 'abc', NOW)).toEqual(CLAIM);
    expect(await verifyConnectToken(KEY, token, 'abc', CLAIM.expiresAt)).toBeNull();
    expect(await verifyConnectToken(KEY, token, 'other', NOW)).toBeNull();
  });

  test('refuse one that lives longer than a connect token may', async () => {
    const token = await createConnectToken(KEY, { ...CLAIM, expiresAt: NOW + CONNECT_TOKEN_TTL_MS + 1 });
    expect(await verifyConnectToken(KEY, token, 'abc', NOW)).toBeNull();
  });

  test('refuse another key, a changed payload or a broken token', async () => {
    const token = await createConnectToken(KEY, CLAIM);
    const other = serializeBase64Url(new Uint8Array(32).fill(4));
    expect(await verifyConnectToken(other, token, 'abc', NOW)).toBeNull();
    const [, signature] = token.split('.');
    const forged = `${serializeBase64Url(encodeText(JSON.stringify({ i: 'abc', u: '1', e: CLAIM.expiresAt })))}.${signature}`;
    expect(await verifyConnectToken(KEY, forged, 'abc', NOW)).toBeNull();
    expect(await verifyConnectToken(KEY, 'one-part', 'abc', NOW)).toBeNull();
    expect(await verifyConnectToken(KEY, `${token}.extra`, 'abc', NOW)).toBeNull();
    expect(await verifyConnectToken(KEY, '!.!', 'abc', NOW)).toBeNull();
    expect(await verifyConnectToken('', token, 'abc', NOW)).toBeNull();
  });

  test('refuse a signed payload that is not a claim', async () => {
    expect(await verifyConnectToken(KEY, await signRaw(new Uint8Array([0xff])), 'abc', NOW)).toBeNull();
    expect(await verifyConnectToken(KEY, await signRaw(encodeText('{')), 'abc', NOW)).toBeNull();
    expect(await verifyConnectToken(KEY, await signRaw(encodeText('{"i":"abc"}')), 'abc', NOW)).toBeNull();
  });

  test('cannot be made without a key', async () => {
    await expect(createConnectToken('', CLAIM)).rejects.toThrow('not valid');
  });
});
