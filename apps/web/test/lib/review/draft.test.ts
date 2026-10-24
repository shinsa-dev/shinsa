import { describe, expect, it } from 'bun:test';
import { serializeComments } from '@/lib/review/draft.ts';

describe('serializeComments', () => {
  it('sends the note first, then every line comment with its place', () => {
    const text = serializeComments(
      [
        { id: '1', path: 'src/a.ts', line: 12, text: 'Use the shared helper.' },
        { id: '2', path: 'src/b.ts', line: 3, text: 'Rename this.' },
      ],
      'Close, two small things.'
    );
    expect(text).toBe(
      'Close, two small things.\n\nLine comments:\n- src/a.ts:12: Use the shared helper.\n- src/b.ts:3: Rename this.'
    );
  });

  it('sends only the line comments when there is no note', () => {
    expect(serializeComments([{ id: '1', path: 'a.ts', line: 1, text: 'Why?' }], '')).toBe(
      'Line comments:\n- a.ts:1: Why?'
    );
  });

  it('sends only the note when there are no line comments', () => {
    expect(serializeComments([], 'Looks good.')).toBe('Looks good.');
    expect(serializeComments([], '')).toBe('');
  });
});
