import { describe, expect, test } from 'bun:test';
import { parseBase32, serializeBase32, serializeBase64Url } from '../../src/remote/bytes.ts';
import {
  isPreviewId,
  isPreviewKey,
  PREVIEW_ID_BYTES,
  PREVIEW_KEY_BYTES,
  parsePreviewHost,
  parsePreviewLabel,
  parsePreviewTunnelPath,
  parsePreviewUrl,
  resolvePreviewOrigin,
  resolvePreviewTunnelPath,
  serializePreviewLabel,
  serializePreviewPage,
  serializePreviewUrl,
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

describe('the preview page', () => {
  test('says the message in a page of its own, escaping what a message could carry', () => {
    const page = serializePreviewPage('Ends at <5> & "soon"');
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('<p>Ends at &lt;5&gt; &amp; &quot;soon&quot;</p>');
    expect(page).not.toContain('<5>');
  });
});
