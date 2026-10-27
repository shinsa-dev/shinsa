import { describe, expect, test } from 'bun:test';
import { assertRefName, slugify } from '../../src/git/index.ts';

describe('assertRefName', () => {
  test('passes branch names through and refuses anything git could read as an option', () => {
    for (const name of ['main', 'feat/x-1', 'release/1.0', 'origin/main'])
      expect(assertRefName(name)).toBe(name);
    for (const name of [
      '-x',
      '--upload-pack=touch /tmp/x',
      'a..b',
      'a/',
      'a.lock',
      'a b',
      'x;rm',
      'a//b',
      '',
    ]) {
      expect(() => assertRefName(name)).toThrow('is not a branch name');
    }
  });
});

describe('slugify', () => {
  test('makes a short kebab slug and never an empty one', () => {
    expect(slugify('Fix the Tab-Scroll!')).toBe('fix-the-tab-scroll');
    expect(slugify('a very long title that keeps going', 12)).toBe('a-very-long');
    expect(slugify('!!!')).toBe('task');
  });
});
