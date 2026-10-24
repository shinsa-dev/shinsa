import { describe, expect, test } from 'bun:test';
import { isCommitSha, resolveImageType } from '../../src/index.ts';

describe('isCommitSha', () => {
  test('accepts a full object id and nothing a person could type as a ref', () => {
    expect(isCommitSha('a'.repeat(40))).toBe(true);
    expect(isCommitSha('b'.repeat(64))).toBe(true);
    for (const ref of ['main', 'HEAD', 'a'.repeat(39), 'A'.repeat(40), `${'a'.repeat(40)}^`, '--all']) {
      expect(isCommitSha(ref)).toBe(false);
    }
  });
});

describe('resolveImageType', () => {
  test('names the image type from the extension, in any case', () => {
    expect(resolveImageType('assets/Logo.PNG')).toBe('image/png');
    expect(resolveImageType('photo.jpeg')).toBe('image/jpeg');
    expect(resolveImageType('icon.svg')).toBeNull();
    expect(resolveImageType('Makefile')).toBeNull();
  });
});
