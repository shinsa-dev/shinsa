import { describe, expect, test } from 'bun:test';
import { serializeBase64Url } from '../../src/remote/bytes.ts';
import {
  isShareId,
  parseShareLocation,
  parseShareUrl,
  resolveShareChannelUrl,
  resolveShareConnectPath,
  resolveSharePagePath,
  resolveSharePreviewApiPath,
  resolveSharePreviewCodeApiPath,
  resolveSharePreviewDiffApiPath,
  SHARE_ID_BYTES,
  SHARE_KEY_BYTES,
  serializeShareUrl,
} from '../../src/remote/shares.ts';

const SHARE_ID = serializeBase64Url(new Uint8Array(SHARE_ID_BYTES).fill(7));

const KEY = serializeBase64Url(new Uint8Array(SHARE_KEY_BYTES).fill(9));

describe('the share link', () => {
  test('carries the machine and the share in its path, and the key only in its fragment', () => {
    const url = serializeShareUrl('https://app.shinsa.dev', {
      instanceId: 'inst',
      shareId: SHARE_ID,
      key: KEY,
    });
    expect(url).toBe(`https://app.shinsa.dev/share/inst/${SHARE_ID}#${KEY}`);
    expect(new URL(url).pathname).not.toContain(KEY);
    expect(parseShareUrl(url)).toEqual({ instanceId: 'inst', shareId: SHARE_ID, key: KEY });
    expect(resolveSharePagePath('inst', SHARE_ID)).toBe(`/share/inst/${SHARE_ID}`);
  });

  test('is refused without its key, with a short id or key, or as anything but a share page', () => {
    expect(parseShareLocation(`/share/inst/${SHARE_ID}`, '')).toBeNull();
    expect(parseShareLocation(`/share/inst/${SHARE_ID}`, '#short')).toBeNull();
    expect(parseShareLocation('/share/inst/short', `#${KEY}`)).toBeNull();
    expect(parseShareLocation(`/tasks/${SHARE_ID}`, `#${KEY}`)).toBeNull();
    expect(parseShareUrl(null)).toBeNull();
    expect(parseShareUrl('not a url')).toBeNull();
  });

  test('knows a share id by its length', () => {
    expect(isShareId(SHARE_ID)).toBe(true);
    expect(isShareId('abc')).toBe(false);
    expect(isShareId('../x')).toBe(false);
  });

  test('names the connect route, the channel and the preview routes', () => {
    expect(resolveShareConnectPath('inst')).toBe('/__remote/shares/inst/connect');
    expect(resolveShareChannelUrl('wss://t-inst.shinsa.dev', 'a b')).toBe(
      'wss://t-inst.shinsa.dev/share?id=a%20b'
    );
    expect(resolveSharePreviewApiPath('task 1')).toBe('/api/tasks/task%201/share/preview');
    expect(resolveSharePreviewDiffApiPath('task-1')).toBe('/api/tasks/task-1/share/preview/diff');
    expect(resolveSharePreviewCodeApiPath('task-1')).toBe('/api/tasks/task-1/share/preview/code');
  });
});
