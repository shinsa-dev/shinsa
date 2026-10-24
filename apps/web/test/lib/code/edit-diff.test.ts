import { describe, expect, it } from 'bun:test';
import { type DiffRow, resolveDiffRows } from '@/lib/code/edit-diff.ts';

function rebuild(rows: DiffRow[], side: 'before' | 'after') {
  const dropped = side === 'before' ? 'add' : 'remove';
  return rows
    .filter((row) => row.kind !== dropped)
    .map((row) => row.text)
    .join('\n');
}

function describeRows(rows: DiffRow[]) {
  return rows.map((row) => `${row.kind} ${row.oldIndex ?? '-'} ${row.newIndex ?? '-'} ${row.text}`);
}

describe('resolveDiffRows', () => {
  it('shows a changed line as a removal then an addition between unchanged lines', () => {
    expect(describeRows(resolveDiffRows('a\nb\nc', 'a\nB\nc'))).toEqual([
      'context 0 0 a',
      'remove 1 - b',
      'add - 1 B',
      'context 2 2 c',
    ]);
  });

  it('shows an inserted line on its own', () => {
    expect(describeRows(resolveDiffRows('a\nc', 'a\nb\nc'))).toEqual([
      'context 0 0 a',
      'add - 1 b',
      'context 1 2 c',
    ]);
  });

  it('shows a deleted line on its own', () => {
    expect(describeRows(resolveDiffRows('a\nb\nc', 'a\nc'))).toEqual([
      'context 0 0 a',
      'remove 1 - b',
      'context 2 1 c',
    ]);
  });

  it('treats an empty side as no lines at all', () => {
    expect(describeRows(resolveDiffRows('', 'x\ny'))).toEqual(['add - 0 x', 'add - 1 y']);
    expect(describeRows(resolveDiffRows('x', ''))).toEqual(['remove 0 - x']);
    expect(resolveDiffRows('', '')).toEqual([]);
  });

  it('keeps the longest common run of lines unchanged', () => {
    const rows = resolveDiffRows('x\na\nb\nc\ny', 'a\nb\nz\nc');
    expect(rows.filter((row) => row.kind === 'context').map((row) => row.text)).toEqual(['a', 'b', 'c']);
  });

  it('always rebuilds both texts from its rows', () => {
    const pairs: [string, string][] = [
      ['a\nb\nc\nd', 'd\nc\nb\na'],
      ['one\ntwo\nthree', 'zero\none\nthree\nfour'],
      ['same\nsame\nsame', 'same\nother\nsame'],
      ['if (a) {\n  run();\n}\n', 'if (a) {\n  run();\n  stop();\n}\n'],
    ];
    for (const [before, after] of pairs) {
      const rows = resolveDiffRows(before, after);
      expect(rebuild(rows, 'before')).toBe(before);
      expect(rebuild(rows, 'after')).toBe(after);
    }
  });

  it('replaces the whole text instead of comparing edits too large to diff', () => {
    const lines = Array.from({ length: 700 }, (_, index) => `line ${index}`).join('\n');
    const rows = resolveDiffRows(lines, lines);
    expect(rows).toHaveLength(1400);
    expect(rows.slice(0, 700).every((row) => row.kind === 'remove')).toBe(true);
    expect(rows.slice(700).every((row) => row.kind === 'add')).toBe(true);
    expect(rows[700]).toEqual({ kind: 'add', text: 'line 0', oldIndex: null, newIndex: 0 });
  });
});
