import { describe, expect, it } from 'bun:test';
import { DEVICE_NAME_LIMIT } from '@shinsa/core';
import { resolveDeviceName } from '@/lib/remote/device-name.ts';

const BOB = { id: '4', login: 'bobstone', name: 'Bob Stone', avatarUrl: null };

const AGENTS = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
  pixel:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  tablet:
    'Mozilla/5.0 (Linux; Android 15; Tab) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) OPR/100.0',
};

describe('the device name a request starts with', () => {
  it('names the device and, off a phone or tablet, the browser', () => {
    expect(resolveDeviceName(AGENTS.iphone, true, null)).toBe('iPhone');
    expect(resolveDeviceName(AGENTS.ipad, true, null)).toBe('iPad');
    expect(resolveDeviceName(AGENTS.ipad, false, null)).toBe('Safari on Mac');
    expect(resolveDeviceName(AGENTS.mac, false, null)).toBe('Chrome on Mac');
    expect(resolveDeviceName(AGENTS.windows, false, null)).toBe('Edge on Windows PC');
    expect(resolveDeviceName(AGENTS.pixel, true, null)).toBe('Android phone');
    expect(resolveDeviceName(AGENTS.tablet, true, null)).toBe('Android tablet');
    expect(resolveDeviceName(AGENTS.linux, false, null)).toBe('Firefox on Linux PC');
    expect(resolveDeviceName(AGENTS.chromebook, false, null)).toBe('Opera on Chromebook');
    expect(resolveDeviceName('curl/8', false, null)).toBe('Browser');
  });

  it('starts an invite with the first name on GitHub, or the login without one', () => {
    expect(resolveDeviceName(AGENTS.iphone, true, BOB)).toBe('Bob iPhone');
    expect(resolveDeviceName(AGENTS.mac, false, { ...BOB, name: null })).toBe('bobstone Chrome on Mac');
    expect(resolveDeviceName(AGENTS.mac, false, { ...BOB, name: ' ' })).toBe('bobstone Chrome on Mac');
    const long = { ...BOB, name: 'x'.repeat(80) };
    expect(resolveDeviceName(AGENTS.mac, false, long)).toHaveLength(DEVICE_NAME_LIMIT);
  });
});
