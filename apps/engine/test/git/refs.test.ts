import { describe, expect, test } from 'bun:test';
import { Effect, Result } from 'effect';
import { slugify } from '../../src/git/index.ts';
import { decodeRefName } from '../../src/git/ref-name.ts';
import { RefName } from '../../src/git/schema.ts';

function readRefName(name: string) {
  return Effect.runSync(Effect.result(decodeRefName(name)));
}

describe('decodeRefName', () => {
  test('passes branch names through and refuses anything git could read as an option', () => {
    for (const name of ['main', 'feat/x-1', 'release/1.0', 'origin/main'])
      expect(Result.getOrThrow(readRefName(name))).toBe(RefName.make(name));
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
      expect(Result.flip(readRefName(name))).toMatchObject({
        success: {
          _tag: 'RefNameInvalid',
          ref: name,
          message: `"${name}" is not a branch name Shinsa will pass to git.`,
        },
      });
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
