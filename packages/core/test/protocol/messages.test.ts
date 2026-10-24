import { describe, expect, test } from 'bun:test';
import { isQuietSurface, isSurface, SURFACES } from '../../src/protocol/messages.ts';

describe('isSurface', () => {
  test('knows the desktop app and a browser page, nothing else', () => {
    expect(SURFACES.every(isSurface)).toBe(true);
    expect(isSurface('floaty')).toBe(false);
    expect(isSurface(null)).toBe(false);
    expect(isSurface({ surface: 'desktop' })).toBe(false);
  });
});

describe('isQuietSurface', () => {
  test('a browser page stays quiet while the desktop app is connected', () => {
    expect(isQuietSurface('browser', true)).toBe(true);
    expect(isQuietSurface('browser', false)).toBe(false);
  });

  test('the desktop app always notifies', () => {
    expect(isQuietSurface('desktop', true)).toBe(false);
    expect(isQuietSurface('desktop', false)).toBe(false);
  });
});
