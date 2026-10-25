import { describe, expect, it } from 'bun:test';
import {
  createLineComment,
  describeCommentLines,
  describeCommentPlace,
  type LineComment,
  readStoredComments,
  serializeComments,
  writeStoredComments,
} from '@/lib/review/draft.ts';

function comment(
  overrides: Partial<LineComment> & Pick<LineComment, 'id' | 'path' | 'line' | 'text'>
): LineComment {
  return { side: 'new', endLine: null, ref: null, ...overrides };
}

describe('serializeComments', () => {
  it('sends each comment with its place and words, and nothing kept only in the browser', () => {
    expect(
      serializeComments([
        comment({ id: '1', path: 'src/a.ts', line: 4, endLine: 5, ref: 'abc', text: 'Merge these.' }),
        comment({ id: '2', path: 'src/c.ts', side: 'old', line: 8, text: 'Keep this check.' }),
      ])
    ).toEqual([
      { path: 'src/a.ts', side: 'new', line: 4, endLine: 5, text: 'Merge these.' },
      { path: 'src/c.ts', side: 'old', line: 8, endLine: null, text: 'Keep this check.' },
    ]);
  });
});

describe('createLineComment', () => {
  it('fills in the new side, and no range, and drops a range of one line', () => {
    expect(createLineComment({ path: 'a.ts', line: 3, endLine: 3, text: 'x' }, 'id')).toEqual(
      comment({ id: 'id', path: 'a.ts', line: 3, text: 'x' })
    );
    expect(
      createLineComment({ path: 'a.ts', line: 3, endLine: 6, side: 'old', ref: 'abc', text: 'x' }, 'id')
    ).toMatchObject({
      side: 'old',
      endLine: 6,
      ref: 'abc',
    });
  });
});

describe('describing a comment', () => {
  it('names its lines and side', () => {
    expect(describeCommentLines({ side: 'new', line: 2, endLine: null })).toBe('Line 2');
    expect(describeCommentLines({ side: 'new', line: 2, endLine: 4 })).toBe('Lines 2–4');
    expect(describeCommentLines({ side: 'old', line: 2, endLine: null })).toBe('Removed line 2');
    expect(describeCommentPlace({ path: 'a.ts', side: 'old', line: 2, endLine: 3 })).toBe(
      'a.ts, removed lines 2-3'
    );
    expect(describeCommentPlace({ path: 'a.ts', side: 'old', line: 2, endLine: null })).toBe(
      'a.ts, removed line 2'
    );
    expect(describeCommentPlace({ path: 'a.ts', side: 'new', line: 2, endLine: 3 })).toBe('a.ts:2-3');
    expect(describeCommentPlace({ path: 'a.ts', side: 'new', line: 2, endLine: null })).toBe('a.ts:2');
  });
});

describe('the stored draft', () => {
  it('survives a reload, keeps only well-formed comments and is gone once empty', () => {
    const first = comment({ id: '1', path: 'a.ts', line: 1, text: 'x' });
    writeStoredComments('gate-1', [first]);
    expect(readStoredComments('gate-1')).toEqual([first]);
    const malformed = { ...first, id: '3', text: 4 };
    localStorage.setItem('shinsa.review-draft.gate-2', JSON.stringify([first, { id: 2 }, null, malformed]));
    expect(readStoredComments('gate-2')).toEqual([first]);
    localStorage.setItem('shinsa.review-draft.gate-3', '{not json');
    expect(readStoredComments('gate-3')).toEqual([]);
    localStorage.setItem('shinsa.review-draft.gate-4', '{"a":1}');
    expect(readStoredComments('gate-4')).toEqual([]);
    writeStoredComments('gate-1', []);
    expect(localStorage.getItem('shinsa.review-draft.gate-1')).toBeNull();
  });
});
