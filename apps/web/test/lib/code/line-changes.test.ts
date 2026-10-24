import { describe, expect, it } from 'bun:test';
import { countLineChanges } from '@/lib/code/line-changes.ts';

describe('countLineChanges', () => {
  it('counts a changed line as one removed and one added', () => {
    expect(countLineChanges('a\nb\nc', 'a\nB\nc')).toEqual({ added: 1, removed: 1 });
  });

  it('counts inserted and deleted lines on their own', () => {
    expect(countLineChanges('a\nc', 'a\nb\nc')).toEqual({ added: 1, removed: 0 });
    expect(countLineChanges('a\nb\nc', 'a\nc')).toEqual({ added: 0, removed: 1 });
  });

  it('treats an empty side as no lines at all', () => {
    expect(countLineChanges('', 'x\ny')).toEqual({ added: 2, removed: 0 });
    expect(countLineChanges('x', '')).toEqual({ added: 0, removed: 1 });
    expect(countLineChanges('', '')).toEqual({ added: 0, removed: 0 });
  });

  it('keeps the longest common run of lines unchanged', () => {
    expect(countLineChanges('x\na\nb\nc\ny', 'a\nb\nz\nc')).toEqual({ added: 1, removed: 2 });
    expect(countLineChanges('a\nb\nc\nd', 'd\nc\nb\na')).toEqual({ added: 3, removed: 3 });
  });

  it('counts every line as replaced when the texts are too large to compare', () => {
    const lines = Array.from({ length: 700 }, (_, index) => `line ${index}`).join('\n');
    expect(countLineChanges(lines, lines)).toEqual({ added: 700, removed: 700 });
  });
});
