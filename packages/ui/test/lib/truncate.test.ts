import { describe, expect, it } from 'bun:test';
import { countVisibleChars, ELLIPSIS, isClipped, resolveMiddleTruncation } from '../../src/lib/truncate';

const monospace = (candidate: string) => candidate.length * 10;

describe('resolveMiddleTruncation', () => {
  it('keeps as many characters as fit, split around one ellipsis with the extra one at the head', () => {
    expect(resolveMiddleTruncation('feature/long-branch-name', 100, monospace)).toBe('featu…name');
    expect(resolveMiddleTruncation('abcdefghij', 60, monospace)).toBe('abc…ij');
  });

  it('always cuts, since it is only asked once the text overflows', () => {
    expect(resolveMiddleTruncation('abcdef', 1000, monospace)).toBe('abc…ef');
  });

  it('falls back to the bare ellipsis when no character fits', () => {
    expect(resolveMiddleTruncation('abcdef', 5, monospace)).toBe(ELLIPSIS);
    expect(resolveMiddleTruncation('', 100, monospace)).toBe(ELLIPSIS);
  });

  it('measures with the caller’s ruler and keeps the split even, whatever the glyph widths', () => {
    const wide = (candidate: string) =>
      [...candidate].reduce((sum, char) => sum + (char === 'W' ? 30 : 10), 0);
    expect(resolveMiddleTruncation('WWWWabcd', 70, wide)).toBe('W…d');
    expect(resolveMiddleTruncation('WWWWabcd', 80, wide)).toBe('WW…d');
  });
});

describe('isClipped', () => {
  const box = { scrollWidth: 100, clientWidth: 100, scrollHeight: 40, clientHeight: 40 };

  it('reads the inline axis for one-line truncation', () => {
    expect(isClipped(box, 'inline')).toBe(false);
    expect(isClipped({ ...box, scrollWidth: 101 }, 'inline')).toBe(true);
  });

  it('reads the block axis for line clamps, ignoring a sub-pixel rounding', () => {
    expect(isClipped({ ...box, scrollHeight: 41 }, 'block')).toBe(false);
    expect(isClipped({ ...box, scrollHeight: 42 }, 'block')).toBe(true);
  });
});

describe('countVisibleChars', () => {
  it('counts the characters that end inside the box', () => {
    expect(countVisibleChars([10, 20, 30, 40], 25)).toBe(2);
    expect(countVisibleChars([10, 20, 30.4], 30)).toBe(3);
  });

  it('counts every character when none is cut off', () => {
    expect(countVisibleChars([10, 20], 100)).toBe(2);
  });

  it('never counts fewer than one', () => {
    expect(countVisibleChars([10, 20], 0)).toBe(1);
    expect(countVisibleChars([], 0)).toBe(1);
  });
});
