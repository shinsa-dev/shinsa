import { describe, expect, it } from 'bun:test';
import type { SearchResult } from '@shinsa/core';
import { describeSearchResult, groupMatches, listKeyedParts, splitMatchText } from '@/lib/code/search.ts';

const MATCHES = [
  { path: 'a.ts', line: 1, column: 1, text: 'hello' },
  { path: 'b.ts', line: 4, column: 2, text: 'hello there' },
  { path: 'a.ts', line: 9, column: 3, text: 'say hello' },
];

function result(overrides: Partial<SearchResult>): SearchResult {
  return { ref: 'r', matches: MATCHES, truncated: false, timedOut: false, ...overrides };
}

describe('groupMatches', () => {
  it('groups matches by file in the order files first appear', () => {
    expect(groupMatches(MATCHES).map((group) => [group.path, group.matches.length])).toEqual([
      ['a.ts', 2],
      ['b.ts', 1],
    ]);
  });
});

describe('describeSearchResult', () => {
  it('counts results and files, and says when it stopped early', () => {
    expect(describeSearchResult(result({}))).toBe('3 results in 2 files.');
    expect(describeSearchResult(result({ truncated: true }))).toBe(
      '3 results in 2 files. There are more; narrow the search to see them.'
    );
    expect(describeSearchResult(result({ timedOut: true }))).toBe(
      '3 results in 2 files. The search took too long, so these are the first it found.'
    );
    expect(describeSearchResult(result({ matches: [] }))).toBe('No results.');
    expect(describeSearchResult(result({ matches: [], timedOut: true }))).toBe(
      'The search took too long and was stopped.'
    );
  });
});

describe('splitMatchText', () => {
  it('marks every match, literally or as a pattern, in or out of case', () => {
    expect(
      splitMatchText('Hello hello', 'hello', { regex: false, caseSensitive: true, wholeWord: false })
    ).toEqual([
      { text: 'Hello ', hit: false },
      { text: 'hello', hit: true },
    ]);
    expect(
      splitMatchText('a.b axb', 'a.b', { regex: false, caseSensitive: false, wholeWord: false })
    ).toEqual([
      { text: 'a.b', hit: true },
      { text: ' axb', hit: false },
    ]);
    expect(splitMatchText('a1 b22', '\\d+', { regex: true, caseSensitive: false, wholeWord: false })).toEqual(
      [
        { text: 'a', hit: false },
        { text: '1', hit: true },
        { text: ' b', hit: false },
        { text: '22', hit: true },
      ]
    );
  });

  it('marks only whole words when asked', () => {
    expect(
      splitMatchText('cat concat cat', 'cat', { regex: false, caseSensitive: true, wholeWord: true })
    ).toEqual([
      { text: 'cat', hit: true },
      { text: ' concat ', hit: false },
      { text: 'cat', hit: true },
    ]);
  });

  it('shows the text plain when the pattern is broken, empty or matches nothing visible', () => {
    expect(splitMatchText('abc', '(', { regex: true, caseSensitive: false, wholeWord: false })).toEqual([
      { text: 'abc', hit: false },
    ]);
    expect(splitMatchText('abc', '', { regex: false, caseSensitive: false, wholeWord: false })).toEqual([
      { text: 'abc', hit: false },
    ]);
    expect(splitMatchText('abc', 'x*', { regex: true, caseSensitive: false, wholeWord: false })).toEqual([
      { text: 'abc', hit: false },
    ]);
  });
});

describe('listKeyedParts', () => {
  it('keys each part by where it starts', () => {
    expect(listKeyedParts([{ text: 'ab' }, { text: 'c' }, { text: 'de' }]).map((part) => part.key)).toEqual([
      '0',
      '2',
      '3',
    ]);
  });
});
