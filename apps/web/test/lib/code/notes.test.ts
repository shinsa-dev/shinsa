import { describe, expect, it } from 'bun:test';
import type { ReviewFinding } from '@shinsa/core';
import {
  listCommentNotes,
  listFileNotes,
  listFindingNotes,
  listSpotMarks,
  resolveCommentRange,
} from '@/lib/code/notes.ts';
import type { LineComment } from '@/lib/review/draft.ts';
import type { ReviewTarget } from '@/lib/review/targets.ts';

function finding(overrides: Partial<ReviewFinding>): ReviewFinding {
  return {
    severity: 'suggestion',
    file: 'a.ts',
    line: 4,
    end: null,
    message: 'Consider a guard.',
    ...overrides,
  };
}

function comment(overrides: Partial<LineComment>): LineComment {
  return {
    id: 'c',
    path: 'a.ts',
    side: 'new',
    line: 2,
    endLine: null,
    ref: 'h',
    text: 'x',
    suggestion: null,
    ...overrides,
  };
}

describe('listFindingNotes', () => {
  it('puts each finding of the file under the last line it points at, blocking ones red', () => {
    const notes = listFindingNotes(
      [
        finding({ severity: 'blocking', line: 3, end: 8, message: 'This drops errors.' }),
        finding({ file: 'b.ts' }),
        finding({ line: null }),
        finding({}),
      ],
      'a.ts'
    );
    expect(notes).toEqual([
      {
        kind: 'finding',
        key: 'finding:0',
        side: 'new',
        line: 8,
        tone: 'red',
        label: 'Agent review · blocking',
        text: 'This drops errors.',
      },
      {
        kind: 'finding',
        key: 'finding:3',
        side: 'new',
        line: 4,
        tone: 'amber',
        label: 'Agent review',
        text: 'Consider a guard.',
      },
    ]);
  });
});

describe('listCommentNotes', () => {
  it('shows comments of this file made at this commit or at none, under their last line', () => {
    const notes = listCommentNotes(
      [
        comment({ id: '1', endLine: 5 }),
        comment({ id: '2', ref: 'other' }),
        comment({ id: '3', ref: null, side: 'old' }),
        comment({ id: '4', path: 'b.ts' }),
        comment({ id: '5', line: 7, endLine: 9, suggestion: { original: 'a\nb\nc', replacement: '' } }),
        comment({ id: '6', line: 7, suggestion: { original: 'a', replacement: 'b' } }),
      ],
      'a.ts',
      'h'
    );
    expect(notes.map((note) => [note.key, note.side, note.line])).toEqual([
      ['comment:1', 'new', 5],
      ['comment:3', 'old', 2],
      ['comment:5', 'new', 9],
      ['comment:6', 'new', 7],
    ]);
  });
});

describe('listFileNotes', () => {
  it('adds the open comment box under the lines it is for', () => {
    const notes = listFileNotes({
      path: 'a.ts',
      ref: 'h',
      findings: [],
      comments: [],
      composer: { side: 'old', line: 3, endLine: 6 },
    });
    expect(notes).toEqual([
      { kind: 'composer', key: 'composer', side: 'old', line: 6, start: 3, endLine: 6 },
    ]);
    expect(listFileNotes({ path: 'a.ts', ref: 'h', findings: [], comments: [], composer: null })).toEqual([]);
  });
});

describe('listSpotMarks', () => {
  it('marks the spots of this file in their attention tone, the selected one too', () => {
    const target = (key: string, file: string, start: number, end: number): ReviewTarget => ({
      key,
      file,
      start,
      end,
      attention: 'critical',
      why: '',
      section: '',
    });
    expect(
      listSpotMarks(
        [target('0:0', 'a.ts', 4, 6), target('0:1', 'b.ts', 1, 1), target('0:2', 'a.ts', 9, 2)],
        'a.ts',
        '0:0'
      )
    ).toEqual([
      { key: '0:0', from: 4, to: 6, tone: 'red', selected: true },
      { key: '0:2', from: 9, to: 9, tone: 'red', selected: false },
    ]);
  });
});

describe('resolveCommentRange', () => {
  it('comments on the selected lines when the clicked line is among them, else on that line', () => {
    expect(resolveCommentRange(5, { from: 3, to: 6 })).toEqual({ line: 3, endLine: 6 });
    expect(resolveCommentRange(9, { from: 3, to: 6 })).toEqual({ line: 9, endLine: null });
    expect(resolveCommentRange(3, { from: 3, to: 3 })).toEqual({ line: 3, endLine: null });
    expect(resolveCommentRange(3, null)).toEqual({ line: 3, endLine: null });
  });
});
