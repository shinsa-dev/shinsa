import { describe, expect, it } from 'bun:test';
import { describeSuggestionLines, listSuggestionLines, resolveSuggestion } from '@/lib/code/suggestion.ts';

const ORIGINAL = 'one\ntwo\nthree\nfour\n';

describe('resolveSuggestion', () => {
  it('keeps only the lines that changed', () => {
    expect(resolveSuggestion(ORIGINAL, 'one\nTWO\nTHREE\nfour\n')).toEqual({
      line: 2,
      endLine: 3,
      text: 'TWO\nTHREE',
    });
    expect(resolveSuggestion(ORIGINAL, 'one\ntwo\nnew\nthree\nfour\n')).toEqual({
      line: 3,
      endLine: 2,
      text: 'new',
    });
    expect(resolveSuggestion(ORIGINAL, 'one\nfour\n')).toEqual({ line: 2, endLine: 3, text: '' });
    expect(resolveSuggestion(ORIGINAL, ORIGINAL)).toBeNull();
  });
});

describe('listSuggestionLines', () => {
  it('lists the lines a suggestion removes and adds', () => {
    expect(listSuggestionLines(ORIGINAL, { line: 2, endLine: 3, text: 'TWO' })).toEqual({
      removed: ['two', 'three'],
      added: ['TWO'],
    });
    expect(listSuggestionLines(ORIGINAL, { line: 2, endLine: 3, text: '' })).toEqual({
      removed: ['two', 'three'],
      added: [],
    });
    expect(listSuggestionLines(ORIGINAL, { line: 3, endLine: 2, text: 'new' })).toEqual({
      removed: [],
      added: ['new'],
    });
  });
});

describe('describeSuggestionLines', () => {
  it('names the lines it replaces', () => {
    expect(describeSuggestionLines({ line: 3, endLine: 2, text: '' })).toBe('before line 3');
    expect(describeSuggestionLines({ line: 3, endLine: 3, text: '' })).toBe('line 3');
    expect(describeSuggestionLines({ line: 3, endLine: 5, text: '' })).toBe('lines 3–5');
  });
});
