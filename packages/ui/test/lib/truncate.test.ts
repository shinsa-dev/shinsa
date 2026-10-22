import { describe, expect, it } from 'bun:test';
import { ELLIPSIS, isClipped, resolveMiddleTruncation } from '../../src/lib/truncate';

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
