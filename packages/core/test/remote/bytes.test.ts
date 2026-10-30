import { describe, expect, test } from 'bun:test';
import {
  concatBytes,
  decodeText,
  encodeText,
  parseBase64Url,
  serializeBase64Url,
} from '../../src/remote/bytes.ts';

describe('bytes', () => {
  test('round-trips text and joins byte arrays in order', () => {
    expect(decodeText(encodeText('café'))).toBe('café');
    expect([...concatBytes(new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3]))]).toEqual([
      1, 2, 3,
    ]);
  });

  test('refuses text that is not UTF-8', () => {
    expect(() => decodeText(new Uint8Array([0xff, 0xfe]))).toThrow();
  });

  test('writes URL-safe base64 without padding and reads it back', () => {
    const bytes = new Uint8Array([251, 255, 191, 0, 1]);
    const text = serializeBase64Url(bytes);
    expect(text).toBe('-_-_AAE');
    expect([...(parseBase64Url(text) ?? [])]).toEqual([...bytes]);
    expect(parseBase64Url('')?.length).toBe(0);
  });

  test('refuses text that is not base64url', () => {
    expect(parseBase64Url('a+b/')).toBeNull();
    expect(parseBase64Url('abcde')).toBeNull();
    expect(parseBase64Url('ab=')).toBeNull();
  });
});
