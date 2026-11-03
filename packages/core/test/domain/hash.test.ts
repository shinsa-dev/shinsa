import { describe, expect, test } from 'bun:test';
import { hashText } from '../../src/domain/hash.ts';

describe('hashText', () => {
  test('gives the 32-bit FNV-1a hash of the text', () => {
    expect(hashText('')).toBe(0x811c9dc5);
    expect(hashText('a')).toBe(0xe40c292c);
    expect(hashText('foobar')).toBe(0xbf9cf968);
  });
});
