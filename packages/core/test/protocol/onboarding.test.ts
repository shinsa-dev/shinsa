import { describe, expect, test } from 'bun:test';
import { resolveDisplayPath } from '../../src/protocol/onboarding.ts';

describe('resolveDisplayPath', () => {
  test('writes folders inside the home folder with ~ and leaves the rest whole', () => {
    expect(resolveDisplayPath('/Users/me', '/Users/me')).toBe('~');
    expect(resolveDisplayPath('/Users/me/Developer/app', '/Users/me/')).toBe('~/Developer/app');
    expect(resolveDisplayPath('/Users/mel/code', '/Users/me')).toBe('/Users/mel/code');
    expect(resolveDisplayPath('/srv/code', '/Users/me')).toBe('/srv/code');
    expect(resolveDisplayPath('/srv/code', '')).toBe('/srv/code');
  });
});
