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
  return { side: 'new', endLine: null, ref: null, suggestion: null, ...overrides };
}

describe('serializeComments', () => {
  it('sends the note first, then every line comment with its place', () => {
    const text = serializeComments(
      [
        comment({ id: '1', path: 'src/a.ts', line: 12, text: 'Use the shared helper.' }),
        comment({ id: '2', path: 'src/b.ts', line: 3, endLine: 5, text: 'Rename these.' }),
        comment({ id: '3', path: 'src/c.ts', side: 'old', line: 8, text: 'Keep this check.' }),
      ],
      'Close, a few small things.'
    );
    expect(text).toBe(
      [
        'Close, a few small things.',
        '',
        'Line comments:',
        '- src/a.ts:12: Use the shared helper.',
        '- src/b.ts:3-5: Rename these.',
        '- src/c.ts, removed line 8: Keep this check.',
      ].join('\n')
    );
  });

  it('sends a suggested change verbatim, with how to apply it', () => {
    const suggestion = { line: 4, endLine: 5, text: 'const a = 1;\nconst b = 2;' };
    const text = serializeComments(
      [comment({ id: '1', path: 'a.ts', line: 4, endLine: 5, text: '', suggestion })],
      ''
    );
    expect(text).toBe(
      'Line comments:\n- a.ts:4-5:\n  Suggested change for lines 4–5, apply it as written unless that breaks something:\n  ```\nconst a = 1;\nconst b = 2;\n  ```'
    );
  });

  it('sends only the note when there are no line comments', () => {
    expect(serializeComments([], 'Looks good.')).toBe('Looks good.');
    expect(serializeComments([], '')).toBe('');
  });
});

describe('createLineComment', () => {
  it('fills in the new side, no range and no suggestion, and drops a range of one line', () => {
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
      'a.ts, removed line 2-3'
    );
  });
});

describe('the stored draft', () => {
  it('survives a reload, keeps only well-formed comments and is gone once empty', () => {
    const first = comment({ id: '1', path: 'a.ts', line: 1, text: 'x' });
    writeStoredComments('gate-1', [first]);
    expect(readStoredComments('gate-1')).toEqual([first]);
    localStorage.setItem('shinsa.review-draft.gate-2', JSON.stringify([first, { id: 2 }, null]));
    expect(readStoredComments('gate-2')).toEqual([first]);
    localStorage.setItem('shinsa.review-draft.gate-3', '{not json');
    expect(readStoredComments('gate-3')).toEqual([]);
    localStorage.setItem('shinsa.review-draft.gate-4', '{"a":1}');
    expect(readStoredComments('gate-4')).toEqual([]);
    writeStoredComments('gate-1', []);
    expect(localStorage.getItem('shinsa.review-draft.gate-1')).toBeNull();
  });
});
