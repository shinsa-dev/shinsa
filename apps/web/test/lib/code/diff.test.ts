import { describe, expect, it } from 'bun:test';
import {
  type CodeRow,
  findRowIndex,
  resolveCodeRows,
  resolveRowAnchor,
  resolveSegments,
} from '@/lib/code/diff.ts';

function numbered(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`);
}

function replaceLine(count: number, line: number) {
  const content = numbered(count);
  content[line - 1] = `changed ${line}`;
  const patch = `@@ -${line},1 +${line},1 @@\n-line ${line}\n+changed ${line}\n`;
  return { content: `${content.join('\n')}\n`, patch };
}

function describeRows(rows: CodeRow[]) {
  return rows.map((row) => `${row.kind} ${row.oldLine ?? '-'} ${row.newLine ?? '-'} ${row.text}`);
}

const TWO_HUNKS = [
  'diff --git a/letters.txt b/letters.txt',
  'index 1111111..2222222 100644',
  '--- a/letters.txt',
  '+++ b/letters.txt',
  '@@ -2,5 +2,5 @@ heading',
  ' b',
  ' c',
  '-d',
  '+D',
  ' e',
  ' f',
  '@@ -9,2 +9,3 @@',
  ' i',
  ' j',
  '+k',
  '\\ No newline at end of file',
  '',
].join('\n');

describe('resolveCodeRows', () => {
  it('weaves the whole file around the hunks with line numbers on both sides', () => {
    const rows = resolveCodeRows(TWO_HUNKS, 'a\nb\nc\nD\ne\nf\ng\nh\ni\nj\nk');
    expect(describeRows(rows)).toEqual([
      'context 1 1 a',
      'context 2 2 b',
      'context 3 3 c',
      'remove 4 - d',
      'add - 4 D',
      'context 5 5 e',
      'context 6 6 f',
      'context 7 7 g',
      'context 8 8 h',
      'context 9 9 i',
      'context 10 10 j',
      'add - 11 k',
    ]);
  });

  it('shows only the hunks when the file content is not available', () => {
    expect(describeRows(resolveCodeRows(TWO_HUNKS, null))).toEqual([
      'context 2 2 b',
      'context 3 3 c',
      'remove 4 - d',
      'add - 4 D',
      'context 5 5 e',
      'context 6 6 f',
      'context 9 9 i',
      'context 10 10 j',
      'add - 11 k',
    ]);
  });

  it('keeps old line numbers shifted after a hunk that changed the line count', () => {
    const patch = '@@ -1,2 +1,3 @@\n a\n+inserted\n b\n';
    const rows = resolveCodeRows(patch, 'a\ninserted\nb\nc\nd\n');
    expect(describeRows(rows)).toEqual([
      'context 1 1 a',
      'add - 2 inserted',
      'context 2 3 b',
      'context 3 4 c',
      'context 4 5 d',
    ]);
  });

  it('lists every line of an added file once, as additions', () => {
    const rows = resolveCodeRows('@@ -0,0 +1,2 @@\n+one\n+two\n', 'one\ntwo\n');
    expect(describeRows(rows)).toEqual(['add - 1 one', 'add - 2 two']);
  });

  it('lists every line of a removed file as removals numbered from the old file', () => {
    const rows = resolveCodeRows('@@ -1,2 +0,0 @@\n-one\n-two\n', null);
    expect(describeRows(rows)).toEqual(['remove 1 - one', 'remove 2 - two']);
  });

  it('shows a renamed file without text changes as unchanged lines', () => {
    expect(describeRows(resolveCodeRows('', 'a\nb'))).toEqual(['context 1 1 a', 'context 2 2 b']);
    expect(resolveCodeRows('', null)).toEqual([]);
    expect(resolveCodeRows('', '')).toEqual([]);
  });

  it('reads a blank context line that lost its leading space as an empty line', () => {
    const rows = resolveCodeRows('@@ -1,3 +1,3 @@\n a\n\n-b\n+B\n', null);
    expect(describeRows(rows)).toEqual(['context 1 1 a', 'context 2 2 ', 'remove 3 - b', 'add - 3 B']);
  });

  it('keeps diff markers that appear inside the changed text', () => {
    const rows = resolveCodeRows('@@ -1 +1 @@\n---- rule\n++++ rule\n', null);
    expect(describeRows(rows)).toEqual(['remove 1 - --- rule', 'add - 1 +++ rule']);
  });

  it('stops filling unchanged lines at the end of content that is shorter than the patch', () => {
    const rows = resolveCodeRows('@@ -20,1 +20,1 @@\n-x\n+y\n', 'a\nb\nc\n');
    expect(describeRows(rows)).toEqual([
      'context 1 1 a',
      'context 2 2 b',
      'context 3 3 c',
      'remove 20 - x',
      'add - 20 y',
    ]);
  });
});

describe('resolveRowAnchor', () => {
  it('anchors a row to its new line, or its old line when it was removed', () => {
    expect(resolveRowAnchor({ kind: 'add', text: '', oldLine: null, newLine: 7 })).toBe(7);
    expect(resolveRowAnchor({ kind: 'remove', text: '', oldLine: 4, newLine: null })).toBe(4);
    expect(resolveRowAnchor({ kind: 'context', text: '', oldLine: null, newLine: null })).toBe(0);
  });
});

describe('findRowIndex', () => {
  const rows = resolveCodeRows(TWO_HUNKS, null);

  it('finds the row showing a new line', () => {
    expect(rows[findRowIndex(rows, 4)]?.text).toBe('D');
  });

  it('lands on the next shown line when the line is hidden between hunks', () => {
    expect(rows[findRowIndex(rows, 7)]?.text).toBe('i');
  });

  it('falls back to the last row past the end, and to zero without rows', () => {
    expect(findRowIndex(rows, 99)).toBe(rows.length - 1);
    expect(findRowIndex([], 3)).toBe(0);
  });
});

describe('resolveSegments', () => {
  it('folds long unchanged runs around a change into gaps', () => {
    const { content, patch } = replaceLine(30, 15);
    const rows = resolveCodeRows(patch, content);
    expect(resolveSegments(rows, 3, new Set())).toEqual([
      { kind: 'gap', start: 0, end: 11 },
      { kind: 'rows', start: 11, end: 19 },
      { kind: 'gap', start: 19, end: 31 },
    ]);
  });

  it('opens a gap that was expanded and joins it to the rows after it', () => {
    const { content, patch } = replaceLine(30, 15);
    const rows = resolveCodeRows(patch, content);
    expect(resolveSegments(rows, 3, new Set([0]))).toEqual([
      { kind: 'rows', start: 0, end: 19 },
      { kind: 'gap', start: 19, end: 31 },
    ]);
  });

  it('shows a short unchanged run instead of hiding fewer than five lines', () => {
    const { content, patch } = replaceLine(20, 8);
    const rows = resolveCodeRows(patch, content);
    expect(resolveSegments(rows, 3, new Set())).toEqual([
      { kind: 'rows', start: 0, end: 12 },
      { kind: 'gap', start: 12, end: 21 },
    ]);
  });

  it('keeps the context of two nearby changes together in one run', () => {
    const content = numbered(12);
    content[2] = 'x';
    content[8] = 'y';
    const patch = '@@ -3 +3 @@\n-line 3\n+x\n@@ -9 +9 @@\n-line 9\n+y\n';
    const rows = resolveCodeRows(patch, content.join('\n'));
    expect(resolveSegments(rows, 3, new Set())).toEqual([{ kind: 'rows', start: 0, end: 14 }]);
  });

  it('hides a whole file without changes behind one gap', () => {
    const rows = resolveCodeRows('', numbered(8).join('\n'));
    expect(resolveSegments(rows, 3, new Set())).toEqual([{ kind: 'gap', start: 0, end: 8 }]);
    expect(resolveSegments([], 3, new Set())).toEqual([]);
  });
});
