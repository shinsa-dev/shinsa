import { describe, expect, it } from 'bun:test';
import { resolveSuggestion } from '@/lib/code/suggestion.ts';

const ORIGINAL = 'one\ntwo\nthree\nfour\n';

describe('resolveSuggestion', () => {
  it('keeps the lines that changed with the original text they replace', () => {
    expect(resolveSuggestion(ORIGINAL, 'one\nTWO\nTHREE\nfour\n')).toEqual({
      line: 2,
      endLine: 3,
      suggestion: { original: 'two\nthree', replacement: 'TWO\nTHREE' },
    });
    expect(resolveSuggestion(ORIGINAL, 'one\nTWO\nthree\nfour\n')).toEqual({
      line: 2,
      endLine: null,
      suggestion: { original: 'two', replacement: 'TWO' },
    });
  });

  it('anchors an added line to the line before it, so the change always replaces whole lines', () => {
    expect(resolveSuggestion(ORIGINAL, 'one\ntwo\nnew\nthree\nfour\n')).toEqual({
      line: 2,
      endLine: null,
      suggestion: { original: 'two', replacement: 'two\nnew' },
    });
    expect(resolveSuggestion(ORIGINAL, 'zero\none\ntwo\nthree\nfour\n')).toEqual({
      line: 1,
      endLine: null,
      suggestion: { original: 'one', replacement: 'zero\none' },
    });
  });

  it('keeps a deletion apart from a line emptied in place', () => {
    expect(resolveSuggestion(ORIGINAL, 'one\nfour\n')).toEqual({
      line: 1,
      endLine: 3,
      suggestion: { original: 'one\ntwo\nthree', replacement: 'one' },
    });
    expect(resolveSuggestion(ORIGINAL, 'one\n\nthree\nfour\n')).toEqual({
      line: 2,
      endLine: null,
      suggestion: { original: 'two', replacement: '' },
    });
  });

  it('suggests nothing when nothing changed', () => {
    expect(resolveSuggestion(ORIGINAL, ORIGINAL)).toBeNull();
  });
});
