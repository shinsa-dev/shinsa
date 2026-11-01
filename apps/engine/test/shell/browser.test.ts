import { describe, expect, test } from 'bun:test';
import { resolveBrowserCommand } from '../../src/shell/browser.ts';

describe('resolveBrowserCommand', () => {
  test('uses open on the Mac and xdg-open on a Linux desktop', () => {
    expect(resolveBrowserCommand('https://a', 'darwin', {})).toEqual(['open', 'https://a']);
    expect(resolveBrowserCommand('https://a', 'linux', { DISPLAY: ':0' })).toEqual(['xdg-open', 'https://a']);
    expect(resolveBrowserCommand('https://a', 'linux', { WAYLAND_DISPLAY: 'wayland-0' })).toEqual([
      'xdg-open',
      'https://a',
    ]);
  });

  test('finds no browser on a machine without a display', () => {
    expect(resolveBrowserCommand('https://a', 'linux', {})).toBeNull();
    expect(resolveBrowserCommand('https://a')).toEqual(
      process.platform === 'darwin' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY
        ? [expect.any(String), 'https://a']
        : null
    );
  });
});
