import { describe, expect, test } from 'bun:test';
import { Effect, Option } from 'effect';
import { concatBytes, encodeText, serializeBase64Url } from '../../src/remote/bytes.ts';
import { decodeText, parseBase64Url } from '../../src/remote/bytes.ts';
import {
  CONNECT_TOKEN_TTL_MS,
  type ConnectClaim,
  createConnectToken,
  createLegacyConnectToken,
  verifyConnectToken,
} from '../../src/remote/connect-token.ts';

const KEY = serializeBase64Url(new Uint8Array(32).fill(3));

const NOW = 1_800_000_000_000;

const NONCE = serializeBase64Url(new Uint8Array(16).fill(9));

const CLAIM: ConnectClaim = {
  instanceId: 'abc',
  userId: '42',
  channel: 'remote',
  nonce: NONCE,
  expiresAt: NOW + CONNECT_TOKEN_TTL_MS,
};

const REMOTE = { instanceId: 'abc', channel: 'remote' } as const;

const TEAM = { instanceId: 'abc', channel: 'team' } as const;

async function signRaw(payload: Uint8Array<ArrayBuffer>, label = 'shinsa-connect-v1\n') {
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(32).fill(3),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = concatBytes(encodeText(label), payload);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, signed));
  return `${serializeBase64Url(payload)}.${serializeBase64Url(signature)}`;
}

function encodeClaim(fields: Record<string, unknown>) {
  return encodeText(JSON.stringify(fields));
}

describe('connect tokens', () => {
  test('verify for their instance and channel until they expire', async () => {
    const token = await Effect.runPromise(createConnectToken(KEY, CLAIM));
    expect(await Effect.runPromise(verifyConnectToken(KEY, token, REMOTE, NOW))).toEqual(CLAIM);
    expect(await Effect.runPromise(verifyConnectToken(KEY, token, REMOTE, CLAIM.expiresAt))).toBeNull();
    expect(
      await Effect.runPromise(verifyConnectToken(KEY, token, { ...REMOTE, instanceId: 'other' }, NOW))
    ).toBeNull();
  });

  test('a token for the team channel does not open the machine channel, nor the other way', async () => {
    const team = await Effect.runPromise(createConnectToken(KEY, { ...CLAIM, channel: 'team' }));
    expect(await Effect.runPromise(verifyConnectToken(KEY, team, REMOTE, NOW))).toBeNull();
    expect(await Effect.runPromise(verifyConnectToken(KEY, team, TEAM, NOW))).toEqual({
      ...CLAIM,
      channel: 'team',
    });
    const remote = await Effect.runPromise(createConnectToken(KEY, CLAIM));
    expect(await Effect.runPromise(verifyConnectToken(KEY, remote, TEAM, NOW))).toBeNull();
  });

  test('refuse one that lives longer than a connect token may', async () => {
    const token = await Effect.runPromise(
      createConnectToken(KEY, { ...CLAIM, expiresAt: NOW + CONNECT_TOKEN_TTL_MS + 1 })
    );
    expect(await Effect.runPromise(verifyConnectToken(KEY, token, REMOTE, NOW))).toBeNull();
  });

  test('refuse another key, a changed payload or a broken token', async () => {
    const token = await Effect.runPromise(createConnectToken(KEY, CLAIM));
    const other = serializeBase64Url(new Uint8Array(32).fill(4));
    expect(await Effect.runPromise(verifyConnectToken(other, token, REMOTE, NOW))).toBeNull();
    const [, signature] = token.split('.');
    const forged = `${serializeBase64Url(encodeClaim({ i: 'abc', u: '1', c: 'remote', n: NONCE, e: CLAIM.expiresAt }))}.${signature}`;
    expect(await Effect.runPromise(verifyConnectToken(KEY, forged, REMOTE, NOW))).toBeNull();
    expect(await Effect.runPromise(verifyConnectToken(KEY, 'one-part', REMOTE, NOW))).toBeNull();
    expect(await Effect.runPromise(verifyConnectToken(KEY, `${token}.extra`, REMOTE, NOW))).toBeNull();
    expect(await Effect.runPromise(verifyConnectToken(KEY, '!.!', REMOTE, NOW))).toBeNull();
    expect(await Effect.runPromise(verifyConnectToken('', token, REMOTE, NOW))).toBeNull();
  });

  test('refuse a claim signed without the connect label, as another of the key’s tokens would be', async () => {
    const fields = { i: 'abc', u: '42', c: 'remote', n: NONCE, e: CLAIM.expiresAt };
    expect(
      await Effect.runPromise(verifyConnectToken(KEY, await signRaw(encodeClaim(fields), ''), REMOTE, NOW))
    ).toBeNull();
    expect(
      await Effect.runPromise(verifyConnectToken(KEY, await signRaw(encodeClaim(fields)), REMOTE, NOW))
    ).toEqual(CLAIM);
  });

  test('refuse a signed payload that is not a whole claim', async () => {
    const whole = { i: 'abc', u: '42', c: 'remote', n: NONCE, e: CLAIM.expiresAt };
    expect(
      await Effect.runPromise(verifyConnectToken(KEY, await signRaw(new Uint8Array([0xff])), REMOTE, NOW))
    ).toBeNull();
    expect(
      await Effect.runPromise(verifyConnectToken(KEY, await signRaw(encodeText('{')), REMOTE, NOW))
    ).toBeNull();
    expect(
      await Effect.runPromise(verifyConnectToken(KEY, await signRaw(encodeText('[]')), REMOTE, NOW))
    ).toBeNull();
    expect(
      await Effect.runPromise(verifyConnectToken(KEY, await signRaw(encodeText('{"i":"abc"}')), REMOTE, NOW))
    ).toBeNull();
    const { n: _nonce, ...withoutNonce } = whole;
    expect(
      await Effect.runPromise(verifyConnectToken(KEY, await signRaw(encodeClaim(withoutNonce)), REMOTE, NOW))
    ).toBeNull();
    const short = { ...whole, n: 'abc' };
    expect(
      await Effect.runPromise(verifyConnectToken(KEY, await signRaw(encodeClaim(short)), REMOTE, NOW))
    ).toBeNull();
    const unknown = { ...whole, c: 'share' };
    expect(
      await Effect.runPromise(verifyConnectToken(KEY, await signRaw(encodeClaim(unknown)), REMOTE, NOW))
    ).toBeNull();
  });

  test('cannot be made without a key or a nonce', async () => {
    await expect(Effect.runPromise(createConnectToken('', CLAIM))).rejects.toThrow('not valid');
    await expect(Effect.runPromise(createConnectToken(KEY, { ...CLAIM, nonce: 'abc' }))).rejects.toThrow(
      'nonce'
    );
  });

  test('a legacy token is what an older engine checks, and this engine refuses it on every channel', async () => {
    const token = await Effect.runPromise(
      createLegacyConnectToken(KEY, {
        instanceId: 'abc',
        userId: '42',
        expiresAt: CLAIM.expiresAt,
      })
    );
    const [encoded = '', encodedSignature = ''] = token.split('.');
    const payload = Option.getOrNull(parseBase64Url(encoded)) ?? new Uint8Array();
    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(32).fill(3),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signature = Option.getOrNull(parseBase64Url(encodedSignature)) ?? new Uint8Array();
    expect(await crypto.subtle.verify('HMAC', key, signature, payload)).toBe(true);
    expect(JSON.parse(decodeText(payload))).toEqual({ i: 'abc', u: '42', e: CLAIM.expiresAt });
    expect(await Effect.runPromise(verifyConnectToken(KEY, token, REMOTE, NOW))).toBeNull();
    expect(await Effect.runPromise(verifyConnectToken(KEY, token, TEAM, NOW))).toBeNull();
    await expect(
      Effect.runPromise(createLegacyConnectToken('', { instanceId: 'abc', userId: '42', expiresAt: 1 }))
    ).rejects.toThrow('The connect key is not valid.');
  });
});
