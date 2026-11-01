import { describe, expect, test } from 'bun:test';
import { serializeBase64Url } from '../../src/remote/bytes.ts';
import {
  isShareId,
  parseShareLocation,
  parseShareUrl,
  resolveShareChannelUrl,
  resolveShareConnectPath,
  resolveSharePagePath,
  SHARE_ID_BYTES,
  SHARE_KEY_BYTES,
  serializeShareUrl,
} from '../../src/remote/shares.ts';

const SHARE_ID = serializeBase64Url(new Uint8Array(SHARE_ID_BYTES).fill(7));

const KEY = serializeBase64Url(new Uint8Array(SHARE_KEY_BYTES).fill(9));

describe('the share link', () => {
  test('is one opaque token in its path, with the key only in its fragment', () => {
    const url = serializeShareUrl('https://app.shinsa.dev', {
      instanceId: 'inst',
      shareId: SHARE_ID,
      key: KEY,
    });
    const path = resolveSharePagePath('inst', SHARE_ID);
    expect(url).toBe(`https://app.shinsa.dev${path}#${KEY}`);
    expect(path).toMatch(/^\/share\/t\/[A-Za-z0-9_-]+$/);
    expect(path).not.toContain('inst');
    expect(new URL(url).pathname).not.toContain(KEY);
    expect(parseShareUrl(url)).toEqual({ instanceId: 'inst', shareId: SHARE_ID, key: KEY });
  });

  test('is refused without its key, with a short token or key, or as anything but a share page', () => {
    const path = resolveSharePagePath('inst', SHARE_ID);
    expect(parseShareLocation(path, '')).toBeNull();
    expect(parseShareLocation(path, '#short')).toBeNull();
    expect(parseShareLocation(`/share/t/${SHARE_ID}`, `#${KEY}`)).toBeNull();
    expect(parseShareLocation(resolveSharePagePath('../x', SHARE_ID), `#${KEY}`)).toBeNull();
    expect(
      parseShareLocation(`/share/t/${serializeBase64Url(new Uint8Array(20).fill(255))}`, `#${KEY}`)
    ).toBeNull();
    expect(parseShareLocation('/share/t/a!b', `#${KEY}`)).toBeNull();
    expect(parseShareLocation(path.replace(/^\/share\/t\//, '/share/'), `#${KEY}`)).toBeNull();
    expect(parseShareLocation(`${path}/more`, `#${KEY}`)).toBeNull();
    expect(parseShareLocation(`/tasks/${SHARE_ID}`, `#${KEY}`)).toBeNull();
    expect(parseShareUrl(null)).toBeNull();
    expect(parseShareUrl('not a url')).toBeNull();
  });

  test('knows a share id by its length', () => {
    expect(isShareId(SHARE_ID)).toBe(true);
    expect(isShareId('abc')).toBe(false);
    expect(isShareId('../x')).toBe(false);
  });

  test('names the connect route and the channel', () => {
    expect(resolveShareConnectPath('inst')).toBe('/__remote/shares/inst/connect');
    expect(resolveShareChannelUrl('wss://t-inst.shinsa.dev', 'a b')).toBe(
      'wss://t-inst.shinsa.dev/share?id=a%20b'
    );
  });
});
