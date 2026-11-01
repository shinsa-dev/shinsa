import { describe, expect, test } from 'bun:test';
import { parseBase32, serializeBase32, serializeBase64Url } from '../../src/remote/bytes.ts';
import { createConnectToken } from '../../src/remote/connect-token.ts';
import {
  createPreviewAccessToken,
  isPreviewId,
  isPreviewKey,
  PREVIEW_ACCESS_TTL_MS,
  PREVIEW_ID_BYTES,
  PREVIEW_KEY_BYTES,
  PREVIEW_OPEN_TTL_MS,
  parsePreviewHost,
  parsePreviewLabel,
  parsePreviewTunnelPath,
  parsePreviewUrl,
  resolvePreviewOrigin,
  resolvePreviewTunnelPath,
  resolvePrivatePreviewId,
  resolvePrivatePreviewUrl,
  serializePreviewLabel,
  serializePreviewUrl,
  verifyPreviewAccessToken,
} from '../../src/remote/previews.ts';

const PREVIEW_ID = serializeBase64Url(new Uint8Array(PREVIEW_ID_BYTES).fill(7));

const KEY = serializeBase64Url(new Uint8Array(PREVIEW_KEY_BYTES).fill(9));

const ADDRESS = { instanceId: 'k3x9q2m7a1bz', previewId: PREVIEW_ID };

describe('base32', () => {
  test('round-trips every length in lowercase, and refuses what is not canonical', () => {
    for (let length = 0; length <= 12; length++) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) & 255);
      const text = serializeBase32(bytes);
      expect(text).toMatch(/^[a-z2-7]*$/);
      expect(parseBase32(text)).toEqual(bytes);
    }
    expect(serializeBase32(new TextEncoder().encode('foobar'))).toBe('mzxw6ytboi');
    expect(parseBase32('MZXW6')).toBeNull();
    expect(parseBase32('a')).toBeNull();
    expect(parseBase32('abc')).toBeNull();
    expect(parseBase32('abcdef')).toBeNull();
    expect(parseBase32('mb')).toBeNull();
    expect(parseBase32('ma')).toEqual(Uint8Array.from([0x60]));
  });
});

describe('the preview address', () => {
  test('is one DNS label on its own host that names neither task nor machine, with the key in the query', () => {
    const label = serializePreviewLabel(ADDRESS);
    expect(label).toMatch(/^[a-z2-7]+$/);
    expect(label.length).toBeLessThanOrEqual(63);
    expect(label).not.toContain(ADDRESS.instanceId);
    expect(resolvePreviewOrigin(ADDRESS)).toBe(`https://${label}.shinsa.page`);
    const url = serializePreviewUrl({ ...ADDRESS, key: KEY });
    expect(url).toBe(`https://${label}.shinsa.page/?key=${KEY}`);
    expect(parsePreviewUrl(url)).toEqual({ ...ADDRESS, key: KEY });
    expect(parsePreviewHost(`${label.toUpperCase()}.SHINSA.PAGE`)).toEqual(ADDRESS);
  });

  test('works on a stand-in zone, scheme and port included', () => {
    const zone = 'http://preview.localhost:5195';
    const url = serializePreviewUrl({ ...ADDRESS, key: KEY }, zone);
    expect(url).toStartWith(`http://${serializePreviewLabel(ADDRESS)}.preview.localhost:5195/?key=`);
    expect(parsePreviewUrl(url, zone)).toEqual({ ...ADDRESS, key: KEY });
    expect(parsePreviewUrl(url)).toBeNull();
  });

  test('refuses another host, a nested label, a bad label, or a missing or short key', () => {
    const label = serializePreviewLabel(ADDRESS);
    expect(parsePreviewHost(`${label}.shinsa.dev`)).toBeNull();
    expect(parsePreviewHost(`a.${label}.shinsa.page`)).toBeNull();
    expect(parsePreviewHost('shinsa.page')).toBeNull();
    expect(parsePreviewLabel('a'.repeat(64))).toBeNull();
    expect(parsePreviewLabel(serializeBase32(new Uint8Array(PREVIEW_ID_BYTES)))).toBeNull();
    expect(
      parsePreviewLabel(serializeBase32(Uint8Array.from([...new Uint8Array(10), 0xff, 0xfe])))
    ).toBeNull();
    expect(
      parsePreviewLabel(serializeBase32(Uint8Array.from([...new Uint8Array(10), 0x2e, 0x2f])))
    ).toBeNull();
    expect(parsePreviewLabel('not-base32!')).toBeNull();
    expect(parsePreviewUrl(`https://${label}.shinsa.page/`)).toBeNull();
    expect(parsePreviewUrl(`https://${label}.shinsa.page/?key=short`)).toBeNull();
    expect(parsePreviewUrl(`http://${label}.shinsa.page/?key=${KEY}`)).toBeNull();
    expect(parsePreviewUrl(null)).toBeNull();
    expect(parsePreviewUrl('not a url')).toBeNull();
  });

  test('checks ids and keys by their length', () => {
    expect(isPreviewId(PREVIEW_ID)).toBe(true);
    expect(isPreviewId(KEY)).toBe(false);
    expect(isPreviewId('a/b')).toBe(false);
    expect(isPreviewKey(KEY)).toBe(true);
    expect(isPreviewKey(PREVIEW_ID)).toBe(false);
  });
});

describe('the tunnel path', () => {
  test('carries the preview id before the page path, and refuses anything else', () => {
    expect(resolvePreviewTunnelPath(PREVIEW_ID, '/src/main.ts')).toBe(`/__preview/${PREVIEW_ID}/src/main.ts`);
    expect(resolvePreviewTunnelPath(PREVIEW_ID, 'x')).toBe(`/__preview/${PREVIEW_ID}/x`);
    expect(parsePreviewTunnelPath(`/__preview/${PREVIEW_ID}/src/main.ts`)).toEqual({
      previewId: PREVIEW_ID,
      path: '/src/main.ts',
    });
    expect(parsePreviewTunnelPath(`/__preview/${PREVIEW_ID}`)).toEqual({ previewId: PREVIEW_ID, path: '/' });
    expect(parsePreviewTunnelPath('/__preview/short/x')).toBeNull();
    expect(parsePreviewTunnelPath(`/share/${PREVIEW_ID}`)).toBeNull();
  });
});

const CONNECT_KEY = serializeBase64Url(new Uint8Array(32).fill(3));

const OTHER_KEY = serializeBase64Url(new Uint8Array(32).fill(4));

const NOW = 1_000_000;

describe('a private preview', () => {
  test('has an id derived from the connect key, the service and the task, stable for the same run', async () => {
    const run = { serviceId: 'web', taskId: 'task-1' };
    const id = await resolvePrivatePreviewId(CONNECT_KEY, run);
    expect(isPreviewId(id)).toBe(true);
    expect(await resolvePrivatePreviewId(CONNECT_KEY, run)).toBe(id);
    expect(await resolvePrivatePreviewId(OTHER_KEY, run)).not.toBe(id);
    expect(await resolvePrivatePreviewId(CONNECT_KEY, { serviceId: 'web', taskId: null })).not.toBe(id);
    expect(await resolvePrivatePreviewId(CONNECT_KEY, { serviceId: 'api', taskId: 'task-1' })).not.toBe(id);
    await expect(resolvePrivatePreviewId('', run)).rejects.toThrow('The connect key is not valid.');
  });

  test('keeps the local page, query and fragment on its own origin', () => {
    expect(resolvePrivatePreviewUrl(ADDRESS, 'http://localhost:4123/tasks/SW-17?tab=a#top')).toBe(
      `${resolvePreviewOrigin(ADDRESS)}/tasks/SW-17?tab=a#top`
    );
    expect(resolvePrivatePreviewUrl(ADDRESS, 'http://localhost:4123', 'http://localhost:5195')).toBe(
      `${resolvePreviewOrigin(ADDRESS, 'http://localhost:5195')}/`
    );
  });
});

describe('a preview access token', () => {
  const claim = { ...ADDRESS, userId: 'u1', expiresAt: NOW + PREVIEW_ACCESS_TTL_MS };

  test('opens its own preview for its account until it expires', async () => {
    const token = await createPreviewAccessToken(CONNECT_KEY, claim);
    expect(await verifyPreviewAccessToken(CONNECT_KEY, token, ADDRESS, NOW)).toEqual(claim);
    expect(await verifyPreviewAccessToken(CONNECT_KEY, token, ADDRESS, claim.expiresAt)).toBeNull();
  });

  test('is refused for another preview, another machine, another key or a longer life than allowed', async () => {
    const token = await createPreviewAccessToken(CONNECT_KEY, claim);
    const other = serializeBase64Url(new Uint8Array(PREVIEW_ID_BYTES).fill(8));
    expect(
      await verifyPreviewAccessToken(CONNECT_KEY, token, { ...ADDRESS, previewId: other }, NOW)
    ).toBeNull();
    expect(
      await verifyPreviewAccessToken(CONNECT_KEY, token, { ...ADDRESS, instanceId: 'other' }, NOW)
    ).toBeNull();
    expect(await verifyPreviewAccessToken(OTHER_KEY, token, ADDRESS, NOW)).toBeNull();
    expect(await verifyPreviewAccessToken(CONNECT_KEY, token, ADDRESS, NOW, PREVIEW_OPEN_TTL_MS)).toBeNull();
    const open = await createPreviewAccessToken(CONNECT_KEY, {
      ...claim,
      expiresAt: NOW + PREVIEW_OPEN_TTL_MS,
    });
    expect(
      await verifyPreviewAccessToken(CONNECT_KEY, open, ADDRESS, NOW, PREVIEW_OPEN_TTL_MS)
    ).not.toBeNull();
  });

  test('is refused when tampered with, malformed, or a connect token', async () => {
    const token = await createPreviewAccessToken(CONNECT_KEY, claim);
    const [payload, signature] = token.split('.');
    const forged = serializeBase64Url(new TextEncoder().encode(JSON.stringify({ ...claim, u: 'u2' })));
    expect(await verifyPreviewAccessToken(CONNECT_KEY, `${forged}.${signature}`, ADDRESS, NOW)).toBeNull();
    expect(await verifyPreviewAccessToken(CONNECT_KEY, `${token}.x`, ADDRESS, NOW)).toBeNull();
    expect(await verifyPreviewAccessToken(CONNECT_KEY, payload as string, ADDRESS, NOW)).toBeNull();
    expect(await verifyPreviewAccessToken(CONNECT_KEY, '!.!', ADDRESS, NOW)).toBeNull();
    expect(await verifyPreviewAccessToken('', token, ADDRESS, NOW)).toBeNull();
    const connect = await createConnectToken(CONNECT_KEY, {
      instanceId: ADDRESS.instanceId,
      userId: 'u1',
      expiresAt: NOW + 1,
    });
    expect(await verifyPreviewAccessToken(CONNECT_KEY, connect, ADDRESS, NOW)).toBeNull();
    await expect(createPreviewAccessToken('', claim)).rejects.toThrow('The connect key is not valid.');
  });

  test('is refused when its signed payload is not a claim', async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(32).fill(3),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sign = async (payload: Uint8Array<ArrayBuffer>) => {
      const signed = new Uint8Array([...new TextEncoder().encode('shinsa-preview-access\n'), ...payload]);
      const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, signed));
      return `${serializeBase64Url(payload)}.${serializeBase64Url(signature)}`;
    };
    const text = (value: string) => new TextEncoder().encode(value);
    for (const payload of [text('not json'), text('{"i":"x","p":"y"}'), Uint8Array.from([0xff, 0xfe])]) {
      expect(await verifyPreviewAccessToken(CONNECT_KEY, await sign(payload), ADDRESS, NOW)).toBeNull();
    }
  });
});
